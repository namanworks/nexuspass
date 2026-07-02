const pool = require("../pool");

async function getSlotById(slotId) {
  const result = await pool.query(
    "SELECT id, seat_label, status, price, event_id FROM slots WHERE id = $1",
    [slotId],
  );
  return result.rows[0] || null;
}

async function lockSlot(client, slotId) {
  const result = await client.query(
    `SELECT id, seat_label, price, status, event_id
     FROM slots
     WHERE id = $1 AND status = 'available'
     FOR UPDATE SKIP LOCKED`,
    [slotId],
  );
  return result.rows[0] || null;
}

async function setSlotLocked(client, slotId) {
  await client.query(`UPDATE slots SET status = 'locked' WHERE id = $1`, [
    slotId,
  ]);
}

async function releaseSlot(client, slotId) {
  await client.query(`UPDATE slots SET status = 'available' WHERE id = $1`, [
    slotId,
  ]);
}

async function setSlotSold(client, slotId) {
  await client.query(`UPDATE slots SET status = 'sold' WHERE id = $1`, [
    slotId,
  ]);
}

async function getSlotsByEvent(eventId) {
  const result = await pool.query(
    `SELECT id, seat_label, status, price
     FROM slots
     WHERE event_id = $1
     ORDER BY seat_label`,
    [eventId],
  );
  return result.rows;
}

module.exports = {
  getSlotById,
  lockSlot,
  setSlotLocked,
  releaseSlot,
  setSlotSold,
  getSlotsByEvent,
};
