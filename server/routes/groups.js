const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { generateSecret } = require("otplib");
const pool = require("../db/pool");
const { authenticateToken } = require("../middleware/authenticateToken");
const { requireFields } = require("../middleware/validateInput");

const { getEventById } = require("../db/queries/events");
const {
  createGroup,
  addMemberToGroup,
  getMemberInvite,
  updateMemberPayment,
  lockBookingGroup,
  allSeatedMembersPaid,
} = require("../db/queries/groups");
const {
  getGroupByToken,
  getGroupById,
  getGroupInvitesByGroup,
  confirmBookingGroup,
} = require("../db/queries/bookings");
const { setSlotSold } = require("../db/queries/slots");
const {
  createTicket,
  createTransaction,
  checkIdempotencyKey,
} = require("../db/queries/tickets");
const { simulatePayment } = require("../utils/mockPayment");
const { getIO } = require("../socket");

const router = express.Router();

router.post(
  "/create",
  authenticateToken,
  requireFields("eventId"),
  async (req, res, next) => {
    try {
      const { eventId } = req.body;
      const { userId } = req.user;

      const event = await getEventById(eventId);
      if (!event) {
        return res.status(404).json({
          error: true,
          message: "Event not found.",
          code: "NOT_FOUND",
        });
      }

      const inviteLinkToken = uuidv4();
      const group = await createGroup(eventId, userId, inviteLinkToken);
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
  },
);

router.post("/join/:token", authenticateToken, async (req, res, next) => {
  try {
    const { token } = req.params;
    const { userId } = req.user;

    const group = await getGroupByToken(token);
    if (!group) {
      return res.status(404).json({
        error: true,
        message: "Group session not found.",
        code: "NOT_FOUND",
      });
    }

    if (group.status !== "pending") {
      return res.status(409).json({
        error: true,
        message: "This group session has already expired or been confirmed.",
        code: "GROUP_EXPIRED",
      });
    }

    if (new Date(group.expires_at) < new Date()) {
      return res.status(409).json({
        error: true,
        message: "This group session has expired.",
        code: "GROUP_EXPIRED",
      });
    }

    await addMemberToGroup(group.id, userId);

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
});

router.get("/:groupId", authenticateToken, async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await getGroupById(groupId);
    if (!group) {
      return res.status(404).json({
        error: true,
        message: "Group session not found.",
        code: "NOT_FOUND",
      });
    }

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
});

router.post(
  "/:groupId/pay",
  authenticateToken,
  requireFields("slotId", "idempotencyKey"),
  async (req, res, next) => {
    try {
      const { groupId } = req.params;
      const { slotId, idempotencyKey } = req.body;
      const { userId } = req.user;

      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({
          error: true,
          message: "This payment has already been processed.",
          code: "DUPLICATE_REQUEST",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const group = await lockBookingGroup(client, groupId);
        if (!group) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            error: true,
            message: "Group session not found.",
            code: "NOT_FOUND",
          });
        }

        if (group.status !== "pending") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: true,
            message:
              "This group session has already expired or been confirmed.",
            code: "GROUP_EXPIRED",
          });
        }

        if (new Date(group.expires_at) < new Date()) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: true,
            message: "The booking window for this group has expired.",
            code: "GROUP_EXPIRED",
          });
        }

        const invite = await getMemberInvite(client, groupId, userId);

        if (!invite) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            error: true,
            message: "You are not a member of this group.",
            code: "FORBIDDEN",
          });
        }

        if (!invite.seat_id) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: true,
            message: "You have not selected a seat yet. Reserve a seat first.",
            code: "VALIDATION_ERROR",
          });
        }

        if (invite.seat_id !== slotId) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: true,
            message:
              "The slot ID does not match your reserved seat in this group.",
            code: "VALIDATION_ERROR",
          });
        }

        if (invite.payment_status === "paid") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: true,
            message: "You have already paid for this seat.",
            code: "DUPLICATE_REQUEST",
          });
        }

        const paymentResult = await simulatePayment(
          parseFloat(invite.price),
          userId,
        );

        if (!paymentResult.success) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            error: true,
            message: "Payment failed. Please try again.",
            code: "PAYMENT_FAILED",
          });
        }

        await updateMemberPayment(client, groupId, userId, "paid");
        await setSlotSold(client, slotId);

        const totpSeed = generateSecret();
        const ticket = await createTicket(client, {
          slotId,
          userId,
          groupId,
          purchasedPrice: parseFloat(invite.price),
          totpSeed,
        });

        await createTransaction(client, {
          userId,
          ticketId: ticket.id,
          amount: parseFloat(invite.price),
          type: "purchase",
          idempotencyKey,
        });

        const allPaid = await allSeatedMembersPaid(client, groupId);
        if (allPaid) {
          await confirmBookingGroup(client, groupId);
        }

        await client.query("COMMIT");

        try {
          const io = getIO();
          io.to(group.event_id).emit("seat_update", {
            seatId: slotId,
            status: "sold",
          });
          io.to(groupId).emit("group_update", {
            groupId,
            memberId: userId,
            paymentStatus: "paid",
          });
        } catch (socketErr) {
          console.warn(
            "[SOCKET] Could not emit payment events:",
            socketErr.message,
          );
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
        await client.query("ROLLBACK");

        if (
          txErr.code === "23505" &&
          txErr.constraint === "transactions_idempotency_key_key"
        ) {
          return res.status(409).json({
            error: true,
            message: "This payment has already been processed.",
            code: "DUPLICATE_REQUEST",
          });
        }
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:groupId/pay-all",
  authenticateToken,
  requireFields("idempotencyKey"),
  async (req, res, next) => {
    try {
      const { groupId } = req.params;
      const { idempotencyKey } = req.body;
      const { userId } = req.user;

      const alreadyUsed = await checkIdempotencyKey(idempotencyKey);
      if (alreadyUsed) {
        return res.status(409).json({
          error: true,
          message: "This payment has already been processed.",
          code: "DUPLICATE_REQUEST",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const group = await lockBookingGroup(client, groupId);
        if (!group) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            error: true,
            message: "Group session not found.",
            code: "NOT_FOUND",
          });
        }

        if (group.leader_user_id !== userId) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            error: true,
            message: "Only the group leader can pay for everyone.",
            code: "FORBIDDEN",
          });
        }

        if (
          group.status !== "pending" ||
          new Date(group.expires_at) < new Date()
        ) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: true,
            message: "This group session is expired or confirmed.",
            code: "GROUP_EXPIRED",
          });
        }

        const invites = await getGroupInvitesByGroup(client, groupId);
        const unpaidSeated = invites.filter(
          (inv) => inv.seat_id && inv.payment_status === "pending",
        );

        if (unpaidSeated.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: true,
            message: "No unpaid seats found in this group.",
            code: "VALIDATION_ERROR",
          });
        }

        const totalAmount = unpaidSeated.reduce(
          (sum, inv) => sum + parseFloat(inv.price),
          0,
        );

        const paymentResult = await simulatePayment(totalAmount, userId);
        if (!paymentResult.success) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            error: true,
            message: "Payment failed.",
            code: "PAYMENT_FAILED",
          });
        }

        const tickets = [];

        for (const inv of unpaidSeated) {
          await updateMemberPayment(client, groupId, inv.user_id, "paid");
          await setSlotSold(client, inv.seat_id);

          const totpSeed = generateSecret();
          const ticket = await createTicket(client, {
            slotId: inv.seat_id,
            userId: inv.user_id,
            groupId,
            purchasedPrice: parseFloat(inv.price),
            totpSeed,
          });

          tickets.push({
            ticketId: ticket.id,
            seatLabel: inv.seat_label,
            userId: inv.user_id,
          });

          await createTransaction(client, {
            userId,
            ticketId: ticket.id,
            amount: parseFloat(inv.price),
            type: "purchase",
            idempotencyKey: `${idempotencyKey}-${inv.user_id}`,
          });
        }

        const allPaid = await allSeatedMembersPaid(client, groupId);
        if (allPaid) {
          await confirmBookingGroup(client, groupId);
        }

        await client.query("COMMIT");

        try {
          const io = getIO();
          for (const inv of unpaidSeated) {
            io.to(group.event_id).emit("seat_update", {
              seatId: inv.seat_id,
              status: "sold",
            });
            io.to(groupId).emit("group_update", {
              groupId,
              memberId: inv.user_id,
              paymentStatus: "paid",
            });
          }
        } catch (socketErr) {
          console.warn("[SOCKET] Could not emit events:", socketErr.message);
        }

        return res.status(200).json({
          success: true,
          data: {
            tickets,
            expiresAt: group.expires_at,
          },
        });
      } catch (txErr) {
        await client.query("ROLLBACK");
        if (txErr.code === "23505") {
          return res
            .status(409)
            .json({ error: true, message: "Duplicate payment processed." });
        }
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
