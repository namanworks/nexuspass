require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  console.log('[SEED] Starting seed...');

  try {
    // ─────────────────────────────────────────────
    // Categories
    // ─────────────────────────────────────────────
    const catResult = await pool.query(`
      INSERT INTO categories (name) VALUES
        ('Concert'),
        ('Movie'),
        ('Comedy')
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `);

    // Re-fetch categories to ensure we have IDs even if already seeded
    const categories = await pool.query('SELECT id, name FROM categories');
    const catMap = {};
    categories.rows.forEach((c) => { catMap[c.name] = c.id; });
    console.log('[SEED] ✓ Categories:', Object.keys(catMap).join(', '));

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    // Helper: build a timestamp offset from NOW
    function daysFromNow(days, timeOverride = null) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      if (timeOverride) {
        const [hours, minutes] = timeOverride.split(':').map(Number);
        d.setHours(hours, minutes, 0, 0);
      }
      return d.toISOString();
    }

    // 1. Arijit Singh Live — Concert — 14 days from now
    const concertResult = await pool.query(
      `INSERT INTO events (category_id, title, venue, start_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [catMap['Concert'], 'Arijit Singh Live', 'NSCI Dome, Mumbai', daysFromNow(14)]
    );
    const concertId = concertResult.rows[0].id;
    console.log('[SEED] ✓ Event: Arijit Singh Live');

    // 2. Kalki 2898-AD — Movie — 3 showtimes tomorrow
    const showtimes = ['10:00', '14:00', '18:00'];
    const movieEventIds = [];
    for (const time of showtimes) {
      const res = await pool.query(
        `INSERT INTO events (category_id, title, venue, start_time)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [catMap['Movie'], `Kalki 2898-AD (${time})`, 'PVR Cinemas, Delhi', daysFromNow(1, time)]
      );
      movieEventIds.push(res.rows[0].id);
    }
    console.log('[SEED] ✓ Events: Kalki 2898-AD (3 showtimes)');

    // 3. Zakir Khan Live — Comedy — 10 days from now
    const comedyResult = await pool.query(
      `INSERT INTO events (category_id, title, venue, start_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [catMap['Comedy'], 'Zakir Khan Live', 'Siri Fort Auditorium, Delhi', daysFromNow(10)]
    );
    const comedyId = comedyResult.rows[0].id;
    console.log('[SEED] ✓ Event: Zakir Khan Live');

    // ─────────────────────────────────────────────
    // Slots (Seats)
    // ─────────────────────────────────────────────

    // Helper: generate seat labels for given rows and cols
    function generateSeats(rows, cols) {
      const seats = [];
      for (const row of rows) {
        for (let col = 1; col <= cols; col++) {
          seats.push(`${row}${col}`);
        }
      }
      return seats;
    }

    // Helper: bulk insert slots for an event
    async function insertSlots(eventId, seats, price) {
      const values = seats
        .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
        .join(', ');
      const params = seats.flatMap((seat) => [eventId, seat, price]);
      await pool.query(
        `INSERT INTO slots (event_id, seat_label, price) VALUES ${values}`,
        params
      );
    }

    // Concert: A1–A10, B1–B10, C1–C10, D1–D10, E1–E10 → 50 seats @ ₹999
    const concertSeats = generateSeats(['A', 'B', 'C', 'D', 'E'], 10);
    await insertSlots(concertId, concertSeats, 999.00);
    console.log(`[SEED] ✓ Concert slots: ${concertSeats.length} seats`);

    // Movie: A1–A10, B1–B10, C1–C10 → 30 seats @ ₹250 per showtime
    const movieSeats = generateSeats(['A', 'B', 'C'], 10);
    for (const movieEventId of movieEventIds) {
      await insertSlots(movieEventId, movieSeats, 250.00);
    }
    console.log(`[SEED] ✓ Movie slots: ${movieSeats.length} seats × 3 showtimes`);

    // Comedy: A1–A10, B1–B10, C1–C10, D1–D10 → 40 seats @ ₹599
    const comedySeats = generateSeats(['A', 'B', 'C', 'D'], 10);
    await insertSlots(comedyId, comedySeats, 599.00);
    console.log(`[SEED] ✓ Comedy slots: ${comedySeats.length} seats`);

    // ─────────────────────────────────────────────
    // Admin User
    // ─────────────────────────────────────────────
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO NOTHING`,
      ['Admin', process.env.ADMIN_EMAIL || 'admin@nexuspass.dev', adminPasswordHash]
    );
    console.log('[SEED] ✓ Admin user created (admin@nexuspass.dev / admin123)');

    // ─────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────
    const slotCount = await pool.query('SELECT COUNT(*) FROM slots');
    const eventCount = await pool.query('SELECT COUNT(*) FROM events');
    console.log(`\n[SEED] ✓ Complete!`);
    console.log(`  Events : ${eventCount.rows[0].count}`);
    console.log(`  Slots  : ${slotCount.rows[0].count} (expected 180)`);

  } catch (err) {
    console.error('[SEED] ✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
