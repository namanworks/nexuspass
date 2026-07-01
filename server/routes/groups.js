const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { generateSecret } = require('otplib');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/authenticateToken');
const { requireFields } = require('../middleware/validateInput');

// ── Query modules ───────────────────────────────────────────────────────────
const { getEventById } = require('../db/queries/events');
const {
  createGroup,
  addMemberToGroup,
  getMemberInvite,
  updateMemberPayment,
  lockBookingGroup,
  allSeatedMembersPaid,
} = require('../db/queries/groups');
const {
  getGroupByToken,
  getGroupById,
  getGroupInvitesByGroup,
  confirmBookingGroup,
} = require('../db/queries/bookings');
const { setSlotSold } = require('../db/queries/slots');
const { createTicket, createTransaction, checkIdempotencyKey } = require('../db/queries/tickets');
const { simulatePayment } = require('../utils/mockPayment');
const { getIO } = require('../socket');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/create
// Body: { eventId }
//
// Creates a booking group session for an event. The authenticated user
// becomes the group leader. Returns a shareable invite link token.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/create',
  authenticateToken,
  requireFields('eventId'),
  async (req, res, next) => {
    try {
      const { eventId } = req.body;
      const { userId } = req.user;

      // Validate that the event exists
      const event = await getEventById(eventId);
      if (!event) {
        return res.status(404).json({
          error: true,
          message: 'Event not found.',
          code: 'NOT_FOUND',
        });
      }

      // Create the group session
      const inviteLinkToken = uuidv4();
      const group = await createGroup(eventId, userId, inviteLinkToken);
      
      // Add the leader to the group explicitly
      await addMemberToGroup(group.id, userId);

      return res.status(201).json({
        success: true,
        data: {
          groupId: group.id,
          inviteLink: `/groups/${group.invite_link_token}`,
          expiresAt: group.expires_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/join/:token
// No body required.
//
// Joins an existing booking group via the shareable invite link.
// Idempotent — if the user is already a member, returns the group state.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/join/:token',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { token } = req.params;
      const { userId } = req.user;

      // Find the group by invite token
      const group = await getGroupByToken(token);
      if (!group) {
        return res.status(404).json({
          error: true,
          message: 'Group session not found.',
          code: 'NOT_FOUND',
        });
      }

      // Verify the group is still active
      if (group.status !== 'pending') {
        return res.status(409).json({
          error: true,
          message: 'This group session has already expired or been confirmed.',
          code: 'GROUP_EXPIRED',
        });
      }

      if (new Date(group.expires_at) < new Date()) {
        return res.status(409).json({
          error: true,
          message: 'This group session has expired.',
          code: 'GROUP_EXPIRED',
        });
      }

      // Add the user to the group (idempotent — no-op if already a member)
      await addMemberToGroup(group.id, userId);

      // Fetch the full member list to return
      const members = await getGroupInvitesByGroup(pool, group.id);

      return res.status(200).json({
        success: true,
        data: {
          groupId: group.id,
          eventId: group.event_id,
          expiresAt: group.expires_at,
          leaderUserId: group.leader_user_id,
          members: members.map((m) => ({
            userId: m.user_id,
            name: m.user_name,
            paymentStatus: m.payment_status,
            seatLabel: m.seat_label || null,
            slotId: m.seat_id || null,
            price: m.price ? parseFloat(m.price) : 0,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/groups/:groupId
//
// Returns group details including all members and their payment + seat status.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:groupId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { groupId } = req.params;

      const group = await getGroupById(groupId);
      if (!group) {
        return res.status(404).json({
          error: true,
          message: 'Group session not found.',
          code: 'NOT_FOUND',
        });
      }

      // Fetch all members with seat info
      const members = await getGroupInvitesByGroup(pool, groupId);

      return res.status(200).json({
        success: true,
        data: {
          groupId: group.id,
          eventId: group.event_id,
          expiresAt: group.expires_at,
          status: group.status,
          leaderUserId: group.leader_user_id,
          members: members.map((m) => ({
            userId: m.user_id,
            name: m.user_name,
            paymentStatus: m.payment_status,
            seatLabel: m.seat_label || null,
            slotId: m.seat_id || null,
            price: m.price ? parseFloat(m.price) : 0,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:groupId/pay
// Body: { slotId, idempotencyKey }
//
// Full payment flow for a group member:
//   1. Idempotency pre-check
//   2. BEGIN transaction
//   3. Lock booking_group row (FOR UPDATE) — prevents expiry worker race
//   4. Verify group is pending and not expired
//   5. Verify user is a member with this seat and hasn't already paid
//   6. Run mock payment
//   7. Update group_invite payment_status = 'paid'
//   8. Update slot status = 'sold'
//   9. Create ticket (status='valid', generate totp_seed)
//  10. Create transaction record (type='purchase')
//  11. If all seated members have paid → confirm the group
//  12. COMMIT
//  13. Emit seat_update + group_update via WebSocket
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:groupId/pay',
  authenticateToken,
  requireFields('slotId', 'idempotencyKey'),
  async (req, res, next) => {
    try {
      const { groupId } = req.params;
      const { slotId, idempotencyKey } = req.body;
      const { userId } = req.user;

      // ── Step 1: Idempotency pre-check ─────────────────────────────────
      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({
          error: true,
          message: 'This payment has already been processed.',
          code: 'DUPLICATE_REQUEST',
        });
      }

      // ── Steps 2–12: Atomic transaction ─────────────────────────────────
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Step 3: Lock the booking group row to serialize with expiry worker
        const group = await lockBookingGroup(client, groupId);
        if (!group) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: true,
            message: 'Group session not found.',
            code: 'NOT_FOUND',
          });
        }

        // Step 4: Verify group is active
        if (group.status !== 'pending') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: true,
            message: 'This group session has already expired or been confirmed.',
            code: 'GROUP_EXPIRED',
          });
        }

        if (new Date(group.expires_at) < new Date()) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: true,
            message: 'The booking window for this group has expired.',
            code: 'GROUP_EXPIRED',
          });
        }

        // Step 5: Get user's invite and verify seat ownership
        const invite = await getMemberInvite(client, groupId, userId);

        if (!invite) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: true,
            message: 'You are not a member of this group.',
            code: 'FORBIDDEN',
          });
        }

        if (!invite.seat_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: true,
            message: 'You have not selected a seat yet. Reserve a seat first.',
            code: 'VALIDATION_ERROR',
          });
        }

        if (invite.seat_id !== slotId) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: true,
            message: 'The slot ID does not match your reserved seat in this group.',
            code: 'VALIDATION_ERROR',
          });
        }

        if (invite.payment_status === 'paid') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: true,
            message: 'You have already paid for this seat.',
            code: 'DUPLICATE_REQUEST',
          });
        }

        // Step 6: Run mock payment
        const paymentResult = await simulatePayment(
          parseFloat(invite.price),
          userId
        );

        if (!paymentResult.success) {
          await client.query('ROLLBACK');
          return res.status(500).json({
            error: true,
            message: 'Payment failed. Please try again.',
            code: 'PAYMENT_FAILED',
          });
        }

        // Step 7: Mark the member as paid
        await updateMemberPayment(client, groupId, userId, 'paid');

        // Step 8: Mark the slot as sold
        await setSlotSold(client, slotId);

        // Step 9: Create the ticket with a fresh TOTP seed
        const totpSeed = generateSecret();
        const ticket = await createTicket(client, {
          slotId,
          userId,
          groupId,
          purchasedPrice: parseFloat(invite.price),
          totpSeed,
        });

        // Step 10: Create the purchase transaction record
        await createTransaction(client, {
          userId,
          ticketId: ticket.id,
          amount: parseFloat(invite.price),
          type: 'purchase',
          idempotencyKey,
        });

        // Step 11: If all seated members have now paid, confirm the group
        const allPaid = await allSeatedMembersPaid(client, groupId);
        if (allPaid) {
          await confirmBookingGroup(client, groupId);
        }

        // Step 12: Commit the transaction
        await client.query('COMMIT');

        // ── Step 13: Emit WebSocket events (after commit, non-fatal) ────
        try {
          const io = getIO();

          // Notify all clients viewing this event that the seat is sold
          io.to(group.event_id).emit('seat_update', {
            seatId: slotId,
            status: 'sold',
          });

          // Notify all members in the group that this member has paid
          io.to(groupId).emit('group_update', {
            groupId,
            memberId: userId,
            paymentStatus: 'paid',
          });
        } catch (socketErr) {
          console.warn('[SOCKET] Could not emit payment events:', socketErr.message);
        }

        return res.status(200).json({
          success: true,
          data: {
            ticketId: ticket.id,
            seat: {
              id: slotId,
              seatLabel: invite.seat_label,
            },
            expiresAt: group.expires_at,
          },
        });
      } catch (txErr) {
        await client.query('ROLLBACK');

        // Handle unique constraint violation on idempotency_key (race condition safety net)
        if (txErr.code === '23505' && txErr.constraint === 'transactions_idempotency_key_key') {
          return res.status(409).json({
            error: true,
            message: 'This payment has already been processed.',
            code: 'DUPLICATE_REQUEST',
          });
        }

        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/groups/:groupId/pay-all
// Body: { idempotencyKey }
//
// Pays for all seated, unpaid members in a group by the group leader.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:groupId/pay-all',
  authenticateToken,
  requireFields('idempotencyKey'),
  async (req, res, next) => {
    try {
      const { groupId } = req.params;
      const { idempotencyKey } = req.body;
      const { userId } = req.user;

      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({
          error: true,
          message: 'This payment has already been processed.',
          code: 'DUPLICATE_REQUEST',
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const group = await lockBookingGroup(client, groupId);
        if (!group) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: true, message: 'Group session not found.', code: 'NOT_FOUND' });
        }

        if (group.leader_user_id !== userId) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: true, message: 'Only the group leader can pay for everyone.', code: 'FORBIDDEN' });
        }

        if (group.status !== 'pending' || new Date(group.expires_at) < new Date()) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: true, message: 'This group session is expired or confirmed.', code: 'GROUP_EXPIRED' });
        }

        const invites = await getGroupInvitesByGroup(client, groupId);
        const unpaidSeated = invites.filter(inv => inv.seat_id && inv.payment_status === 'pending');

        if (unpaidSeated.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: true, message: 'No unpaid seats found in this group.', code: 'VALIDATION_ERROR' });
        }

        const totalAmount = unpaidSeated.reduce((sum, inv) => sum + parseFloat(inv.price), 0);

        const paymentResult = await simulatePayment(totalAmount, userId);
        if (!paymentResult.success) {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: true, message: 'Payment failed.', code: 'PAYMENT_FAILED' });
        }

        const tickets = [];

        for (const inv of unpaidSeated) {
          await updateMemberPayment(client, groupId, inv.user_id, 'paid');
          await setSlotSold(client, inv.seat_id);

          const totpSeed = generateSecret();
          const ticket = await createTicket(client, {
            slotId: inv.seat_id,
            userId: inv.user_id,
            groupId,
            purchasedPrice: parseFloat(inv.price),
            totpSeed,
          });

          tickets.push({ ticketId: ticket.id, seatLabel: inv.seat_label, userId: inv.user_id });

          await createTransaction(client, {
            userId, // Leader paid
            ticketId: ticket.id,
            amount: parseFloat(inv.price),
            type: 'purchase',
            idempotencyKey: `${idempotencyKey}-${inv.user_id}`,
          });
        }

        const allPaid = await allSeatedMembersPaid(client, groupId);
        if (allPaid) {
          await confirmBookingGroup(client, groupId);
        }

        await client.query('COMMIT');

        try {
          const io = getIO();
          for (const inv of unpaidSeated) {
            io.to(group.event_id).emit('seat_update', { seatId: inv.seat_id, status: 'sold' });
            io.to(groupId).emit('group_update', { groupId, memberId: inv.user_id, paymentStatus: 'paid' });
          }
        } catch (socketErr) {
          console.warn('[SOCKET] Could not emit events:', socketErr.message);
        }

        return res.status(200).json({
          success: true,
          data: {
            tickets,
            expiresAt: group.expires_at,
          },
        });
      } catch (txErr) {
        await client.query('ROLLBACK');
        if (txErr.code === '23505') {
          return res.status(409).json({ error: true, message: 'Duplicate payment processed.' });
        }
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
