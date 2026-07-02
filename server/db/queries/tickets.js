const pool = require("../pool");

async function createTicket(
  client,
  { slotId, userId, groupId, purchasedPrice, totpSeed },
) {
  const result = await client.query(
    `INSERT INTO tickets (slot_id, user_id, group_id, status, purchased_price, totp_seed)
     VALUES ($1, $2, $3, 'valid', $4, $5)
     RETURNING id, slot_id, user_id, group_id, status, purchased_price, relist_used, created_at`,
    [slotId, userId, groupId, purchasedPrice, totpSeed],
  );
  return result.rows[0];
}

async function createTransaction(
  client,
  { userId, ticketId, amount, type, idempotencyKey },
) {
  const result = await client.query(
    `INSERT INTO transactions (user_id, ticket_id, amount, type, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, ticket_id, amount, type, idempotency_key, created_at`,
    [userId, ticketId, amount, type, idempotencyKey],
  );
  return result.rows[0];
}

async function checkIdempotencyKey(idempotencyKey) {
  const result = await pool.query(
    "SELECT id FROM transactions WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  return result.rows.length > 0;
}

async function getTicketsByUser(userId) {
  const result = await pool.query(
    `SELECT t.id, t.status, t.relist_used,
            s.seat_label,
            e.title as event_title, e.start_time as event_start_time, e.venue as event_venue
     FROM tickets t
     JOIN slots s ON s.id = t.slot_id
     JOIN events e ON e.id = s.event_id
     WHERE t.user_id = $1
     ORDER BY e.start_time ASC`,
    [userId],
  );
  return result.rows;
}

async function getTicketById(ticketId) {
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.status, t.purchased_price, t.relist_used, t.totp_seed,
            s.seat_label,
            e.title as event_title, e.start_time as event_start_time, e.venue as event_venue
     FROM tickets t
     JOIN slots s ON s.id = t.slot_id
     JOIN events e ON e.id = s.event_id
     WHERE t.id = $1`,
    [ticketId],
  );
  return result.rows[0] || null;
}

async function markTicketUsed(ticketId) {
  await pool.query(
    `UPDATE tickets
     SET status = 'used'
     WHERE id = $1`,
    [ticketId],
  );
}

module.exports = {
  createTicket,
  createTransaction,
  checkIdempotencyKey,
  getTicketsByUser,
  getTicketById,
  markTicketUsed,
};
