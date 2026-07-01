const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/authenticateToken');
const { reserveLimiter } = require('../middleware/rateLimiter');
const { requireFields } = require('../middleware/validateInput');
const { lockSlot, setSlotLocked } = require('../db/queries/slots');
const { createBookingGroup, upsertGroupInvite } = require('../db/queries/bookings');
const { getIO } = require('../socket');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// In-memory idempotency cache for reservation requests.
// Maps idempotencyKey → { userId, response }
//
// NOTE for production: Replace this Map with a Redis SETNX call so it works
// across multiple Node.js processes. The Map only provides idempotency within
// a single server process.
// ─────────────────────────────────────────────────────────────────────────────
const idempotencyCache = new Map();

// ─────────────────────────────────────────────
// POST /api/bookings/reserve
// Body: { slotId, groupId (optional), idempotencyKey }
//
// Core concurrency flow:
//   1. Idempotency check — return cached response if key already used
//   2. Quick status check — fast-fail on 'sold' without taking any lock
//   3. BEGIN transaction
//   4. SELECT ... FOR UPDATE SKIP LOCKED — compete for the row lock atomically
//   5. If no row returned → another session holds the lock → 409 SEAT_LOCKED
//   6. If row returned → UPDATE slots SET status = 'locked'
//   7. Create or reuse booking_group
//   8. Upsert group_invite (links this user+seat to the group for expiry tracking)
//   9. COMMIT
//  10. Emit seat_update WebSocket to all clients in the event room
// ─────────────────────────────────────────────
router.post(
  '/reserve',
  authenticateToken,
  reserveLimiter,
  requireFields('slotId', 'idempotencyKey'),
  async (req, res, next) => {
    try {
      const { slotId, groupId, idempotencyKey } = req.body;
      const { userId } = req.user;

      // ── Step 1: Idempotency check ──────────────────────────────────────────
      if (idempotencyCache.has(idempotencyKey)) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached.userId !== userId) {
          return res.status(409).json({
            error: true,
            message: 'Idempotency key already used by a different user.',
            code: 'DUPLICATE_REQUEST',
          });
        }
        // Same user, same key — return the original successful response
        return res.status(201).json({ success: true, data: cached.response });
      }

      // ── Step 2: Fast-fail check (no lock) ─────────────────────────────────
      const preCheck = await pool.query(
        'SELECT id, status FROM slots WHERE id = $1',
        [slotId]
      );

      if (preCheck.rows.length === 0) {
        return res.status(404).json({
          error: true,
          message: 'Seat not found.',
          code: 'NOT_FOUND',
        });
      }

      if (preCheck.rows[0].status === 'sold') {
        return res.status(409).json({
          error: true,
          message: 'This seat has already been sold.',
          code: 'SEAT_SOLD',
        });
      }

      // ── Steps 3–9: Transaction with FOR UPDATE SKIP LOCKED ─────────────────
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // SELECT FOR UPDATE SKIP LOCKED — the core concurrency primitive.
        // If another transaction already holds a row lock on this slot,
        // SKIP LOCKED causes this query to return 0 rows immediately
        // instead of blocking. This prevents deadlocks entirely.
        const lockedSlot = await lockSlot(client, slotId);

        if (!lockedSlot) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: true,
            message: 'This seat is currently being reserved by another user. Please choose a different seat.',
            code: 'SEAT_LOCKED',
          });
        }

        // Flip the slot to 'locked' so other queries can see it without a FOR UPDATE
        await setSlotLocked(client, slotId);

        // Create a new booking group or validate/reuse the provided one
        let bookingGroup;

        if (groupId) {
          // Joining into an existing group — validate it exists and is pending
          const groupResult = await client.query(
            `SELECT id, event_id, leader_user_id, status, expires_at, invite_link_token
             FROM booking_groups
             WHERE id = $1 AND status = 'pending'`,
            [groupId]
          );
          if (groupResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
              error: true,
              message: 'Group session not found or has already expired.',
              code: 'NOT_FOUND',
            });
          }
          bookingGroup = groupResult.rows[0];
        } else {
          // Solo reservation — create a new booking group for this user
          const inviteLinkToken = uuidv4();
          bookingGroup = await createBookingGroup(client, {
            eventId: lockedSlot.event_id,
            leaderUserId: userId,
            inviteLinkToken,
          });
        }

        // Always upsert a group_invite to link this user+seat to the group.
        // This is what the expiry worker queries to release specific seats.
        await upsertGroupInvite(client, {
          groupId: bookingGroup.id,
          userId,
          seatId: slotId,
        });

        await client.query('COMMIT');

        // Build the response payload
        const responseData = {
          bookingGroupId: bookingGroup.id,
          inviteToken: bookingGroup.invite_link_token,
          expiresAt: bookingGroup.expires_at,
          seat: {
            id: lockedSlot.id,
            seatLabel: lockedSlot.seat_label,
            price: parseFloat(lockedSlot.price),
          },
        };

        // Cache under idempotency key — auto-expire after the lock window
        idempotencyCache.set(idempotencyKey, { userId, response: responseData });
        setTimeout(
          () => idempotencyCache.delete(idempotencyKey),
          parseInt(process.env.LOCK_DURATION_MINUTES, 10) * 60 * 1000 || 10 * 60 * 1000
        );

        // ── Step 10: Emit WebSocket event ──────────────────────────────────
        try {
          const io = getIO();
          io.to(lockedSlot.event_id).emit('seat_update', {
            seatId: slotId,
            status: 'locked',
          });
          io.to(bookingGroup.id).emit('group_update', {
            groupId: bookingGroup.id,
            memberId: userId,
            action: 'seat_selected'
          });
        } catch (socketErr) {
          // Non-fatal — Socket.io might not be initialized if called before server start
          console.warn('[SOCKET] Could not emit events:', socketErr.message);
        }

        return res.status(201).json({ success: true, data: responseData });

      } catch (txErr) {
        await client.query('ROLLBACK');
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
