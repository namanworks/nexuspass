const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { category } = req.query;

    let query = `
      SELECT
        e.id,
        e.title,
        e.venue,
        e.start_time,
        e.created_at,
        c.id   AS category_id,
        c.name AS category_name,
        MIN(s.price) AS min_price,
        MAX(s.price) AS max_price,
        COUNT(s.id) FILTER (WHERE s.status = 'available') AS available_seats,
        COUNT(s.id) AS total_seats
      FROM events e
      JOIN categories c ON c.id = e.category_id
      LEFT JOIN slots s ON s.event_id = e.id
    `;

    const params = [];
    if (category) {
      params.push(category);
      query += ` WHERE c.name = $1`;
    }

    query += `
      GROUP BY e.id, c.id
      ORDER BY e.start_time ASC
    `;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: {
        events: result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          venue: row.venue,
          start_time: row.start_time,
          created_at: row.created_at,
          category: {
            id: row.category_id,
            name: row.category_name,
          },
          price_range: {
            min: parseFloat(row.min_price) || 0,
            max: parseFloat(row.max_price) || 0,
          },
          available_seats: parseInt(row.available_seats, 10) || 0,
          total_seats: parseInt(row.total_seats, 10) || 0,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:eventId", async (req, res, next) => {
  try {
    const { eventId } = req.params;

    const eventResult = await pool.query(
      `SELECT
         e.id,
         e.title,
         e.venue,
         e.start_time,
         e.created_at,
         c.id   AS category_id,
         c.name AS category_name
       FROM events e
       JOIN categories c ON c.id = e.category_id
       WHERE e.id = $1`,
      [eventId],
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        error: true,
        message: "Event not found.",
        code: "NOT_FOUND",
      });
    }

    const slotsResult = await pool.query(
      `SELECT id, seat_label, status, price
       FROM slots
       WHERE event_id = $1
       ORDER BY seat_label`,
      [eventId],
    );

    const e = eventResult.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        event: {
          id: e.id,
          title: e.title,
          venue: e.venue,
          start_time: e.start_time,
          category: {
            id: e.category_id,
            name: e.category_name,
          },
        },
        slots: slotsResult.rows.map((s) => ({
          id: s.id,
          seat_label: s.seat_label,
          status: s.status,
          price: parseFloat(s.price),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
