const cron = require('node-cron');
const pool = require('../db/pool');
const {
  getPendingExpiredGroups,
  expireBookingGroup,
  getGroupInvitesByGroup,
} = require('../db/queries/bookings');
const { releaseSlot } = require('../db/queries/slots');
const { getIO } = require('../socket');

/**
 * Core expiry logic — called on each cron tick.
 *
 * Algorithm per spec:
 *   1. Query all booking_groups WHERE status = 'pending' AND expires_at < NOW()
 *   2. For each expired group:
 *      a. BEGIN transaction
 *      b. For each group_invite WHERE payment_status = 'pending':
 *           - Set slot.status = 'available'   (release the seat)
 *      c. Set booking_group.status = 'expired'
 *      d. COMMIT
 *      e. After commit: emit seat_released + seat_update WebSocket events
 *         per seat, NOT per group (granular broadcasts)
 *   3. Log how many groups were expired in this run
 *
 * Partial release rule:
 *   Members who already paid keep their tickets. Only the unpaid
 *   members' seats are released back to 'available'.
 */
async function processExpiredGroups() {
  const expiredGroups = await getPendingExpiredGroups();

  if (expiredGroups.length === 0) return;

  console.log(`[EXPIRY WORKER] ${expiredGroups.length} expired group(s) to process`);

  let processedCount = 0;

  for (const group of expiredGroups) {
    const client = await pool.connect();

    // Collect seat+event info to emit AFTER the transaction commits
    const seatsToRelease = [];

    try {
      await client.query('BEGIN');

      // Get all invites for this group — includes both paid and pending
      const invites = await getGroupInvitesByGroup(client, group.id);

      for (const invite of invites) {
        // Only release seats for members who have NOT paid
        if (invite.payment_status === 'pending' && invite.seat_id) {
          await releaseSlot(client, invite.seat_id);
          seatsToRelease.push({
            seatId: invite.seat_id,
            eventId: group.event_id,
          });
        }
        // paid members' seats remain 'sold' — their tickets are untouched
      }

      // Mark the group itself as expired
      await expireBookingGroup(client, group.id);

      await client.query('COMMIT');
      processedCount++;

      console.log(
        `[EXPIRY WORKER] ✓ Group ${group.id} expired — released ${seatsToRelease.length} seat(s)`
      );

      // ── Emit WebSocket events after commit (outside the transaction) ──
      // Emit one event per seat, not per group — granular per-seat updates
      try {
        const io = getIO();
        for (const { seatId, eventId } of seatsToRelease) {
          // seat_released: reason-aware release event (for UI countdown / expiry notice)
          io.to(eventId).emit('seat_released', {
            seatId,
            reason: 'expired',
          });
          // seat_update: generic status sync so all clients flip the seat green
          io.to(eventId).emit('seat_update', {
            seatId,
            status: 'available',
          });
        }
      } catch (socketErr) {
        // Non-fatal — socket may not yet be active in test environments
        console.warn('[EXPIRY WORKER] Could not emit socket events:', socketErr.message);
      }

    } catch (err) {
      await client.query('ROLLBACK');
      console.error(
        `[EXPIRY WORKER] ✗ Failed to expire group ${group.id}:`,
        err.message
      );
    } finally {
      client.release();
    }
  }

  console.log(
    `[EXPIRY WORKER] Run complete — processed ${processedCount}/${expiredGroups.length} group(s)`
  );
}

/**
 * Start the expiry worker cron job.
 * Runs every 30 seconds using a 6-field cron expression (seconds field).
 * Called once from index.js on server startup.
 */
function startExpiryWorker() {
  // 6-field cron: second minute hour day month weekday
  // '*/30 * * * * *' = every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      await processExpiredGroups();
    } catch (err) {
      console.error('[EXPIRY WORKER] Unhandled error in cron tick:', err.message);
    }
  });

  console.log('[EXPIRY WORKER] Started — running every 30 seconds');
}

module.exports = { startExpiryWorker, processExpiredGroups };
