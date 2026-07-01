const pool = require('../pool');

/**
 * Get an event by ID, joined with its category.
 * Returns null if not found.
 */
async function getEventById(eventId) {
  const result = await pool.query(
    `SELECT e.id, e.title, e.venue, e.start_time, e.created_at,
            c.id AS category_id, c.name AS category_name
     FROM events e
     JOIN categories c ON c.id = e.category_id
     WHERE e.id = $1`,
    [eventId]
  );
  return result.rows[0] || null;
}

module.exports = { getEventById };
