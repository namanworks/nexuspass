const express = require("express");
const { authenticateToken } = require("../middleware/authenticateToken");
const { getTicketsByUser, getTicketById } = require("../db/queries/tickets");

const router = express.Router();

router.get("/", authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.user;
    const tickets = await getTicketsByUser(userId);

    return res.status(200).json({
      success: true,
      data: {
        tickets: tickets.map((t) => ({
          id: t.id,
          status: t.status,
          relist_used: t.relist_used,
          event: {
            title: t.event_title,
            start_time: t.event_start_time,
            venue: t.event_venue,
          },
          seat: {
            seatLabel: t.seat_label,
          },
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:ticketId", authenticateToken, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { userId } = req.user;

    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return res
        .status(404)
        .json({ error: true, message: "Ticket not found.", code: "NOT_FOUND" });
    }

    if (ticket.user_id !== userId) {
      return res.status(403).json({
        error: true,
        message: "You do not have access to this ticket.",
        code: "FORBIDDEN",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: ticket.id,
        status: ticket.status,
        purchased_price: parseFloat(ticket.purchased_price),
        relist_used: ticket.relist_used,
        event: {
          title: ticket.event_title,
          start_time: ticket.event_start_time,
          venue: ticket.event_venue,
        },
        seat: {
          seatLabel: ticket.seat_label,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:ticketId/seed", authenticateToken, async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { userId } = req.user;

    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return res
        .status(404)
        .json({ error: true, message: "Ticket not found.", code: "NOT_FOUND" });
    }

    if (ticket.user_id !== userId) {
      return res.status(403).json({
        error: true,
        message: "You do not have access to this ticket.",
        code: "FORBIDDEN",
      });
    }

    if (ticket.status === "used" || ticket.status === "pending_lock") {
      return res.status(400).json({
        error: true,
        message: "Seed not available for this ticket status.",
        code: "TICKET_ALREADY_USED",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        seed: ticket.totp_seed,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
