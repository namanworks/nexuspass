require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

async function seed() {
  console.log("[SEED] Starting seed...");

  try {
    const catResult = await pool.query(`
      INSERT INTO categories (name) VALUES
        ('Concert'),
        ('Movie'),
        ('Comedy')
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `);

    const categories = await pool.query("SELECT id, name FROM categories");
    const catMap = {};
    categories.rows.forEach((c) => {
      catMap[c.name] = c.id;
    });
    console.log("[SEED] ✓ Categories:", Object.keys(catMap).join(", "));

    function daysFromNow(days, timeOverride = null) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      if (timeOverride) {
        const [hours, minutes] = timeOverride.split(":").map(Number);
        d.setHours(hours, minutes, 0, 0);
      }
      return d.toISOString();
    }

    const concertResult = await pool.query(
      `INSERT INTO events (category_id, title, venue, start_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        catMap["Concert"],
        "Arijit Singh Live",
        "NSCI Dome, Mumbai",
        daysFromNow(14),
      ],
    );
    const concertId = concertResult.rows[0].id;
    console.log("[SEED] ✓ Event: Arijit Singh Live");

    const showtimes = ["10:00", "14:00", "18:00"];
    const movieEventIds = [];
    for (const time of showtimes) {
      const res = await pool.query(
        `INSERT INTO events (category_id, title, venue, start_time)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          catMap["Movie"],
          `Kalki 2898-AD (${time})`,
          "PVR Cinemas, Delhi",
          daysFromNow(1, time),
        ],
      );
      movieEventIds.push(res.rows[0].id);
    }
    console.log("[SEED] ✓ Events: Kalki 2898-AD (3 showtimes)");

    const comedyResult = await pool.query(
      `INSERT INTO events (category_id, title, venue, start_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        catMap["Comedy"],
        "Zakir Khan Live",
        "Siri Fort Auditorium, Delhi",
        daysFromNow(10),
      ],
    );
    const comedyId = comedyResult.rows[0].id;
    console.log("[SEED] ✓ Event: Zakir Khan Live");

    function generateSeats(rows, cols) {
      const seats = [];
      for (const row of rows) {
        for (let col = 1; col <= cols; col++) {
          seats.push(`${row}${col}`);
        }
      }
      return seats;
    }

    async function insertSlots(eventId, seats, price) {
      const values = seats
        .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
        .join(", ");
      const params = seats.flatMap((seat) => [eventId, seat, price]);
      await pool.query(
        `INSERT INTO slots (event_id, seat_label, price) VALUES ${values}`,
        params,
      );
    }

    const concertSeats = generateSeats(["A", "B", "C", "D", "E"], 10);
    await insertSlots(concertId, concertSeats, 999.0);
    console.log(`[SEED] ✓ Concert slots: ${concertSeats.length} seats`);

    const movieSeats = generateSeats(["A", "B", "C"], 10);
    for (const movieEventId of movieEventIds) {
      await insertSlots(movieEventId, movieSeats, 250.0);
    }
    console.log(
      `[SEED] ✓ Movie slots: ${movieSeats.length} seats × 3 showtimes`,
    );

    const comedySeats = generateSeats(["A", "B", "C", "D"], 10);
    await insertSlots(comedyId, comedySeats, 599.0);
    console.log(`[SEED] ✓ Comedy slots: ${comedySeats.length} seats`);

    const adminPasswordHash = await bcrypt.hash("admin123", 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      [
        "Admin",
        process.env.ADMIN_EMAIL || "admin@nexuspass.dev",
        adminPasswordHash,
      ],
    );
    console.log("[SEED] ✓ Admin user created (admin@nexuspass.dev / admin123)");

    const slotCount = await pool.query("SELECT COUNT(*) FROM slots");
    const eventCount = await pool.query("SELECT COUNT(*) FROM events");
    console.log(`\n[SEED] ✓ Complete!`);
    console.log(`  Events : ${eventCount.rows[0].count}`);
    console.log(`  Slots  : ${slotCount.rows[0].count} (expected 180)`);
  } catch (err) {
    console.error("[SEED] ✗ Seed failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
