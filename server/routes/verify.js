const express = require('express');
const { verifySync } = require('otplib');
const { authenticateToken } = require('../middleware/authenticateToken');
const { requireFields } = require('../middleware/validateInput');
const { getTicketById, markTicketUsed } = require('../db/queries/tickets');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/verify
// Auth: Required (Admin only)
// Body: { ticketId, token }
//
// Verifies a ticket using its TOTP token.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  authenticateToken,
  requireFields('ticketId', 'token'),
  async (req, res, next) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ error: true, message: 'Admin access required.', code: 'FORBIDDEN' });
      }

      const { ticketId, token } = req.body;
      const ticket = await getTicketById(ticketId);

      if (!ticket) {
        return res.status(404).json({ error: true, message: 'Ticket not found.', code: 'NOT_FOUND' });
      }

      if (ticket.status === 'used') {
        return res.status(400).json({ error: true, message: 'Ticket has already been used.', code: 'TICKET_ALREADY_USED' });
      }

      if (ticket.status !== 'valid') {
        return res.status(400).json({ error: true, message: 'Ticket is not valid for entry.', code: 'NOT_FOUND' });
      }

      const secret = ticket.totp_seed;
      // Allow a small window for clock drift
      const verification = verifySync({ token, secret, window: 1 });

      if (verification && verification.valid) {
        await markTicketUsed(ticketId);
        return res.status(200).json({
          success: true,
          data: {
            valid: true,
            ticketId,
            seat: { seatLabel: ticket.seat_label },
            event: { title: ticket.event_title },
          }
        });
      } else {
        return res.status(400).json({ error: true, message: 'Invalid or expired QR token.', code: 'INVALID_QR' });
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
