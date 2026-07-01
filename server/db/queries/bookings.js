const pool = require('../pool');

/**
 * Create a booking group inside a transaction.
 * Uses LOCK_DURATION_MINUTES from env for the expiry window.
 */
async function createBookingGroup(client, { eventId, leaderUserId, inviteLinkToken }) {
  const lockMinutes = parseInt(process.env.LOCK_DURATION_MINUTES, 10) || 10;
  const result = await client.query(
    `INSERT INTO booking_groups
       (event_id, leader_user_id, status, expires_at, invite_link_token)
     VALUES
       ($1, $2, 'pending', NOW() + INTERVAL '${lockMinutes} minutes', $3)
     RETURNING id, event_id, leader_user_id, status, expires_at, invite_link_token`,
    [eventId, leaderUserId, inviteLinkToken]
  );
  return result.rows[0];
}

/**
 * Mark a booking group as 'expired' inside a transaction.
 */
async function expireBookingGroup(client, groupId) {
  await client.query(
    `UPDATE booking_groups SET status = 'expired' WHERE id = $1`,
    [groupId]
  );
}

/**
 * Mark a booking group as 'confirmed' inside a transaction.
 */
async function confirmBookingGroup(client, groupId) {
  await client.query(
    `UPDATE booking_groups SET status = 'confirmed' WHERE id = $1`,
    [groupId]
  );
}

/**
 * Fetch all pending booking groups whose expiry time has passed.
 * Used by the expiry background worker.
 */
async function getPendingExpiredGroups() {
  const result = await pool.query(
    `SELECT id, event_id, leader_user_id, expires_at
     FROM booking_groups
     WHERE status = 'pending' AND expires_at < NOW()`
  );
  return result.rows;
}

/**
 * Get a booking group by its invite link token.
 */
async function getGroupByToken(token) {
  const result = await pool.query(
    `SELECT bg.*, e.title as event_title, e.start_time
     FROM booking_groups bg
     JOIN events e ON e.id = bg.event_id
     WHERE bg.invite_link_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Get a booking group by its ID.
 */
async function getGroupById(groupId) {
  const result = await pool.query(
    `SELECT bg.*, e.title as event_title, e.start_time
     FROM booking_groups bg
     JOIN events e ON e.id = bg.event_id
     WHERE bg.id = $1`,
    [groupId]
  );
  return result.rows[0] || null;
}

/**
 * Get all group_invite rows for a booking group, joined with user info.
 * Can be called with a transaction client or the pool.
 */
async function getGroupInvitesByGroup(client, groupId) {
  const result = await client.query(
    `SELECT gi.id, gi.group_id, gi.user_id, gi.seat_id, gi.payment_status, gi.joined_at,
            u.name as user_name, u.email as user_email,
            s.seat_label, s.price
     FROM group_invites gi
     JOIN users u ON u.id = gi.user_id
     LEFT JOIN slots s ON s.id = gi.seat_id
     WHERE gi.group_id = $1`,
    [groupId]
  );
  return result.rows;
}

/**
 * Insert or update a group_invite for a user in a group.
 * If the user already has an invite in this group, update their seat_id.
 * If not, insert a new invite row.
 */
async function upsertGroupInvite(client, { groupId, userId, seatId }) {
  // Check if this user already has an invite in this group
  const existing = await client.query(
    `SELECT id FROM group_invites WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );

  if (existing.rows.length > 0) {
    // Update the seat selection
    await client.query(
      `UPDATE group_invites SET seat_id = $1 WHERE group_id = $2 AND user_id = $3`,
      [seatId, groupId, userId]
    );
    return existing.rows[0].id;
  } else {
    const result = await client.query(
      `INSERT INTO group_invites (group_id, user_id, seat_id, payment_status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [groupId, userId, seatId]
    );
    return result.rows[0].id;
  }
}

module.exports = {
  createBookingGroup,
  expireBookingGroup,
  confirmBookingGroup,
  getPendingExpiredGroups,
  getGroupByToken,
  getGroupById,
  getGroupInvitesByGroup,
  upsertGroupInvite,
};
