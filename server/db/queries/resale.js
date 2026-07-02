const pool = require("../pool");

async function createResaleListing(
  client,
  { ticketId, sellerId, listPrice, purchasedPrice, relistFine, closesAt },
) {
  const result = await client.query(
    `INSERT INTO resale_marketplace (ticket_id, seller_user_id, list_price, purchased_price, relist_fine, closes_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING id, ticket_id, list_price, closes_at`,
    [ticketId, sellerId, listPrice, purchasedPrice, relistFine, closesAt],
  );
  return result.rows[0];
}

async function getResaleListings(eventId) {
  const result = await pool.query(
    `SELECT rm.id, rm.list_price, rm.closes_at,
            t.id as ticket_id,
            s.seat_label,
            u.name as seller_name
     FROM resale_marketplace rm
     JOIN tickets t ON t.id = rm.ticket_id
     JOIN slots s ON s.id = t.slot_id
     JOIN users u ON u.id = rm.seller_user_id
     WHERE s.event_id = $1 AND rm.status = 'active' AND rm.closes_at > NOW()
     ORDER BY rm.list_price ASC`,
    [eventId],
  );
  return result.rows;
}

async function getResaleListingForUpdate(client, listingId) {
  const result = await client.query(
    `SELECT rm.id, rm.status, rm.list_price, rm.seller_user_id, rm.ticket_id,
            t.user_id as ticket_owner_id, t.status as ticket_status,
            s.seat_label,
            e.title as event_title, e.start_time as event_start_time
     FROM resale_marketplace rm
     JOIN tickets t ON t.id = rm.ticket_id
     JOIN slots s ON s.id = t.slot_id
     JOIN events e ON e.id = s.event_id
     WHERE rm.id = $1
     FOR UPDATE`,
    [listingId],
  );
  return result.rows[0] || null;
}

async function markListingSold(client, listingId, buyerId) {
  await client.query(
    `UPDATE resale_marketplace
     SET status = 'sold', buyer_user_id = $1
     WHERE id = $2`,
    [buyerId, listingId],
  );
}

module.exports = {
  createResaleListing,
  getResaleListings,
  getResaleListingForUpdate,
  markListingSold,
};
