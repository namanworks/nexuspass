const pool = require('../pool');

/**
 * Get a single slot by ID (uses pool, outside transaction).
 */
async function getSlotById(slotId) {
  const result = await pool.query(
    'SELECT id, seat_label, status, price, event_id FROM slots WHERE id = $1',
    [slotId]
  );
  return result.rows[0] || null;
}

/**
 * Attempt to lock a slot within a transaction.
 * Uses SELECT FOR UPDATE SKIP LOCKED — returns the row if successfully locked,
 * or null if another connection already holds a lock on it.
 * Must be called with a pg transaction client, not the pool directly.
 */
async function lockSlot(client, slotId) {
  const result = await client.query(
    `SELECT id, seat_label, price, status, event_id
     FROM slots
     WHERE id = $1 AND status = 'available'
     FOR UPDATE SKIP LOCKED`,
    [slotId]
  );
  return result.rows[0] || null;
}

/**
 * Set a slot status to 'locked'. Must run inside a transaction client.
 */
async function setSlotLocked(client, slotId) {
  await client.query(
    `UPDATE slots SET status = 'locked' WHERE id = $1`,
    [slotId]
  );
}

/**
 * Release a slot back to 'available'. Can be called with client or pool.
 */
async function releaseSlot(client, slotId) {
  await client.query(
    `UPDATE slots SET status = 'available' WHERE id = $1`,
    [slotId]
  );
}

/**
 * Mark a slot as 'sold'. Must run inside a transaction client.
 */
async function setSlotSold(client, slotId) {
  await client.query(
    `UPDATE slots SET status = 'sold' WHERE id = $1`,
    [slotId]
  );
}

/**
 * Get all slots for a given event, ordered by seat label.
 */
async function getSlotsByEvent(eventId) {
  const result = await pool.query(
    `SELECT id, seat_label, status, price
     FROM slots
     WHERE event_id = $1
     ORDER BY seat_label`,
    [eventId]
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
