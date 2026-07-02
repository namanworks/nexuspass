const cron = require("node-cron");
const pool = require("../db/pool");
const {
  getPendingExpiredGroups,
  expireBookingGroup,
  getGroupInvitesByGroup,
} = require("../db/queries/bookings");
const { releaseSlot } = require("../db/queries/slots");
const { getIO } = require("../socket");

async function processExpiredGroups() {
  const expiredGroups = await getPendingExpiredGroups();

  if (expiredGroups.length === 0) return;

  console.log(
    `[EXPIRY WORKER] ${expiredGroups.length} expired group(s) to process`,
  );

  let processedCount = 0;

  for (const group of expiredGroups) {
    const client = await pool.connect();

    const seatsToRelease = [];

    try {
      await client.query("BEGIN");

      const invites = await getGroupInvitesByGroup(client, group.id);

      for (const invite of invites) {
        if (invite.payment_status === "pending" && invite.seat_id) {
          await releaseSlot(client, invite.seat_id);
          seatsToRelease.push({
            seatId: invite.seat_id,
            eventId: group.event_id,
          });
        }
      }

      await expireBookingGroup(client, group.id);

      await client.query("COMMIT");
      processedCount++;

      console.log(
        `[EXPIRY WORKER] ✓ Group ${group.id} expired — released ${seatsToRelease.length} seat(s)`,
      );

      try {
        const io = getIO();
        for (const { seatId, eventId } of seatsToRelease) {
          io.to(eventId).emit("seat_released", {
            seatId,
            reason: "expired",
          });

          io.to(eventId).emit("seat_update", {
            seatId,
            status: "available",
          });
        }
      } catch (socketErr) {
        console.warn(
          "[EXPIRY WORKER] Could not emit socket events:",
          socketErr.message,
        );
      }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(
        `[EXPIRY WORKER] ✗ Failed to expire group ${group.id}:`,
        err.message,
      );
    } finally {
      client.release();
    }
  }

  console.log(
    `[EXPIRY WORKER] Run complete — processed ${processedCount}/${expiredGroups.length} group(s)`,
  );
}

function startExpiryWorker() {
  cron.schedule("*/30 * * * * *", async () => {
    try {
      await processExpiredGroups();
    } catch (err) {
      console.error(
        "[EXPIRY WORKER] Unhandled error in cron tick:",
        err.message,
      );
    }
  });

  console.log("[EXPIRY WORKER] Started — running every 30 seconds");
}

module.exports = { startExpiryWorker, processExpiredGroups };
