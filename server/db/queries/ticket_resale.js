const pool = require("../pool");

async function updateTicketForListing(client, ticketId) {
  await client.query(
    `UPDATE tickets
     SET relist_used = true, status = 'listed'
     WHERE id = $1`,
    [ticketId],
  );
}

async function updateTicketForPurchase(client, ticketId, buyerId, newTotpSeed) {
  await client.query(
    `UPDATE tickets
     SET user_id = $1, status = 'valid', totp_seed = $2
     WHERE id = $3`,
    [buyerId, newTotpSeed, ticketId],
  );
}

async function getTicketForUpdate(client, ticketId) {
  const result = await client.query(
    `SELECT t.id, t.user_id, t.status, t.purchased_price, t.relist_used,
            s.event_id, e.title as event_title, e.start_time as event_start_time,
            s.seat_label
     FROM tickets t
     JOIN slots s ON s.id = t.slot_id
     JOIN events e ON e.id = s.event_id
     WHERE t.id = $1
     FOR UPDATE`,
    [ticketId],
  );
  return result.rows[0] || null;
}

module.exports = {
  updateTicketForListing,
  updateTicketForPurchase,
  getTicketForUpdate,
};
