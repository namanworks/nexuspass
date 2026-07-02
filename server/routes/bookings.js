const express = require("express");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { authenticateToken } = require("../middleware/authenticateToken");
const { reserveLimiter } = require("../middleware/rateLimiter");
const { requireFields } = require("../middleware/validateInput");
const { lockSlot, setSlotLocked } = require("../db/queries/slots");
const {
  createBookingGroup,
  upsertGroupInvite,
} = require("../db/queries/bookings");
const { getIO } = require("../socket");

const router = express.Router();

const idempotencyCache = new Map();

router.post(
  "/reserve",
  authenticateToken,
  reserveLimiter,
  requireFields("slotId", "idempotencyKey"),
  async (req, res, next) => {
    try {
      const { slotId, groupId, idempotencyKey } = req.body;
      const { userId } = req.user;

      if (idempotencyCache.has(idempotencyKey)) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached.userId !== userId) {
          return res.status(409).json({
            error: true,
            message: "Idempotency key already used by a different user.",
            code: "DUPLICATE_REQUEST",
          });
        }
        return res.status(201).json({ success: true, data: cached.response });
      }

      const preCheck = await pool.query(
        "SELECT id, status FROM slots WHERE id = $1",
        [slotId],
      );

      if (preCheck.rows.length === 0) {
        return res.status(404).json({
          error: true,
          message: "Seat not found.",
          code: "NOT_FOUND",
        });
      }

      if (preCheck.rows[0].status === "sold") {
        return res.status(409).json({
          error: true,
          message: "This seat has already been sold.",
          code: "SEAT_SOLD",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lockedSlot = await lockSlot(client, slotId);

        if (!lockedSlot) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: true,
            message:
              "This seat is currently being reserved by another user. Please choose a different seat.",
            code: "SEAT_LOCKED",
          });
        }

        await setSlotLocked(client, slotId);

        let bookingGroup;

        if (groupId) {
          const groupResult = await client.query(
            `SELECT id, event_id, leader_user_id, status, expires_at, invite_link_token
             FROM booking_groups
             WHERE id = $1 AND status = 'pending'`,
            [groupId],
          );
          if (groupResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
              error: true,
              message: "Group session not found or has already expired.",
              code: "NOT_FOUND",
            });
          }
          bookingGroup = groupResult.rows[0];
        } else {
          const inviteLinkToken = uuidv4();
          bookingGroup = await createBookingGroup(client, {
            eventId: lockedSlot.event_id,
            leaderUserId: userId,
            inviteLinkToken,
          });
        }

        await upsertGroupInvite(client, {
          groupId: bookingGroup.id,
          userId,
          seatId: slotId,
        });

        await client.query("COMMIT");

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

        idempotencyCache.set(idempotencyKey, {
          userId,
          response: responseData,
        });
        setTimeout(
          () => idempotencyCache.delete(idempotencyKey),
          parseInt(process.env.LOCK_DURATION_MINUTES, 10) * 60 * 1000 ||
            10 * 60 * 1000,
        );

        try {
          const io = getIO();
          io.to(lockedSlot.event_id).emit("seat_update", {
            seatId: slotId,
            status: "locked",
          });
          io.to(bookingGroup.id).emit("group_update", {
            groupId: bookingGroup.id,
            memberId: userId,
            action: "seat_selected",
          });
        } catch (socketErr) {
          console.warn("[SOCKET] Could not emit events:", socketErr.message);
        }

        return res.status(201).json({ success: true, data: responseData });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
