const express = require('express');
const { generateSecret } = require('otplib');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/authenticateToken');
const { requireFields } = require('../middleware/validateInput');
const { simulatePayment } = require('../utils/mockPayment');
const { createTransaction, checkIdempotencyKey } = require('../db/queries/tickets');
const { getTicketForUpdate, updateTicketForListing, updateTicketForPurchase } = require('../db/queries/ticket_resale');
const {
  createResaleListing,
  getResaleListings,
  getResaleListingForUpdate,
  markListingSold,
} = require('../db/queries/resale');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/resale/list
// Body: { ticketId, listPrice, idempotencyKey }
//
// Allows a user to list their ticket for resale, provided it hasn't been
// listed before, and the event is at least 1 hour away.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/list',
  authenticateToken,
  requireFields('ticketId', 'listPrice', 'idempotencyKey'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { ticketId, listPrice, idempotencyKey } = req.body;
      const { userId } = req.user;
      
      const parsedListPrice = parseFloat(listPrice);
      if (isNaN(parsedListPrice) || parsedListPrice <= 0) {
        return res.status(400).json({ error: true, message: 'Invalid list price.', code: 'VALIDATION_ERROR' });
      }

      // Idempotency pre-check
      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({ error: true, message: 'This listing request has already been processed.', code: 'DUPLICATE_REQUEST' });
      }

      await client.query('BEGIN');

      // Step 1: Lock the ticket and fetch details
      const ticket = await getTicketForUpdate(client, ticketId);
      
      if (!ticket) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: true, message: 'Ticket not found.', code: 'NOT_FOUND' });
      }

      // 1. Check ticket ownership
      if (ticket.user_id !== userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: true, message: 'You do not own this ticket.', code: 'FORBIDDEN' });
      }

      // 2. Check relist_used
      if (ticket.relist_used) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: true, message: 'This ticket has already reached its relist limit.', code: 'RELIST_LIMIT_REACHED' });
      }

      // 3. Check time window: event.start_time - NOW() > 1 hour
      const startTime = new Date(ticket.event_start_time);
      const now = new Date();
      const diffHours = (startTime - now) / (1000 * 60 * 60);
      
      if (diffHours <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: true, message: 'Resale window is closed (less than 1 hour to event).', code: 'RELIST_WINDOW_CLOSED' });
      }

      // 4. Check price cap
      const purchasedPrice = parseFloat(ticket.purchased_price);
      if (parsedListPrice > purchasedPrice) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: true, message: 'List price cannot exceed original purchased price.', code: 'VALIDATION_ERROR' });
      }

      // 5. Charge relist fine (e.g., fixed amount or percentage. Let's use 50)
      const RELIST_FINE_AMOUNT = parseFloat(process.env.RELIST_FINE_AMOUNT || '50');
      
      const paymentResult = await simulatePayment(RELIST_FINE_AMOUNT, userId);
      if (!paymentResult.success) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: true, message: 'Payment for relist fine failed.', code: 'PAYMENT_FAILED' });
      }

      // Create transaction for the fine
      await createTransaction(client, {
        userId,
        ticketId,
        amount: RELIST_FINE_AMOUNT,
        type: 'relist_fine',
        idempotencyKey
      });

      // 6. Update ticket
      await updateTicketForListing(client, ticketId);

      // 7. Create resale marketplace row
      const closesAt = new Date(startTime.getTime() - (60 * 60 * 1000)); // event start - 1 hour
      const listing = await createResaleListing(client, {
        ticketId,
        sellerId: userId,
        listPrice: parsedListPrice,
        purchasedPrice,
        relistFine: RELIST_FINE_AMOUNT,
        closesAt: closesAt.toISOString()
      });

      await client.query('COMMIT');

      return res.status(201).json({
        success: true,
        data: {
          listingId: listing.id,
          listPrice: parsedListPrice,
          relistFine: RELIST_FINE_AMOUNT,
          closesAt: listing.closes_at
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint === 'transactions_idempotency_key_key') {
        return res.status(409).json({ error: true, message: 'Duplicate request.', code: 'DUPLICATE_REQUEST' });
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resale/:eventId
// Auth: None required
//
// Fetches all active listings for a given event.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:eventId', async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const listings = await getResaleListings(eventId);
    
    return res.status(200).json({
      success: true,
      data: {
        listings: listings.map(l => ({
          id: l.id,
          listPrice: parseFloat(l.list_price),
          closesAt: l.closes_at,
          seat: { seatLabel: l.seat_label },
          seller: { name: l.seller_name }
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/resale/buy/:listingId
// Body: { idempotencyKey }
//
// Purchases a ticket from the resale marketplace.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/buy/:listingId',
  authenticateToken,
  requireFields('idempotencyKey'),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { listingId } = req.params;
      const { idempotencyKey } = req.body;
      const { userId: buyerId } = req.user;

      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({ error: true, message: 'This purchase has already been processed.', code: 'DUPLICATE_REQUEST' });
      }

      await client.query('BEGIN');

      // 1. Lock listing
      const listing = await getResaleListingForUpdate(client, listingId);
      
      if (!listing) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: true, message: 'Listing not found.', code: 'NOT_FOUND' });
      }

      // Check status
      if (listing.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: true, message: 'This listing is no longer active.', code: 'NOT_FOUND' });
      }

      // 2. Check buyer != seller
      if (listing.seller_user_id === buyerId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: true, message: 'You cannot buy your own listing.', code: 'VALIDATION_ERROR' });
      }

      // Ensure the ticket itself is listed
      if (listing.ticket_status !== 'listed') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: true, message: 'The ticket is not available for purchase.', code: 'VALIDATION_ERROR' });
      }

      // Simulate payment from buyer
      const amount = parseFloat(listing.list_price);
      const paymentResult = await simulatePayment(amount, buyerId);
      if (!paymentResult.success) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: true, message: 'Payment failed.', code: 'PAYMENT_FAILED' });
      }

      // 3 & 4: Generate seed and update ticket
      const newTotpSeed = generateSecret();
      await updateTicketForPurchase(client, listing.ticket_id, buyerId, newTotpSeed);

      // 5: Update listing to sold
      await markListingSold(client, listingId, buyerId);

      // 6: Create transaction for purchase
      await createTransaction(client, {
        userId: buyerId,
        ticketId: listing.ticket_id,
        amount,
        type: 'purchase',
        idempotencyKey
      });

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        data: {
          ticketId: listing.ticket_id,
          seat: { seatLabel: listing.seat_label },
          event: { title: listing.event_title, start_time: listing.event_start_time }
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint === 'transactions_idempotency_key_key') {
        return res.status(409).json({ error: true, message: 'Duplicate purchase request.', code: 'DUPLICATE_REQUEST' });
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

module.exports = router;
