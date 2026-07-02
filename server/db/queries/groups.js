const pool = require("../pool");

async function createGroup(eventId, leaderUserId, inviteLinkToken) {
  const lockMinutes = parseInt(process.env.LOCK_DURATION_MINUTES, 10) || 10;
  const result = await pool.query(
    `INSERT INTO booking_groups
       (event_id, leader_user_id, status, expires_at, invite_link_token)
     VALUES
       ($1, $2, 'pending', NOW() + INTERVAL '1 minute' * $3, $4)
     RETURNING id, event_id, leader_user_id, status, expires_at, invite_link_token`,
    [eventId, leaderUserId, lockMinutes, inviteLinkToken],
  );
  return result.rows[0];
}

async function addMemberToGroup(groupId, userId) {
  const existing = await pool.query(
    `SELECT id, group_id, user_id, seat_id, payment_status
     FROM group_invites
     WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );

  if (existing.rows.length > 0) {
    return { invite: existing.rows[0], alreadyMember: true };
  }

  const result = await pool.query(
    `INSERT INTO group_invites (group_id, user_id, payment_status)
     VALUES ($1, $2, 'pending')
     RETURNING id, group_id, user_id, seat_id, payment_status`,
    [groupId, userId],
  );
  return { invite: result.rows[0], alreadyMember: false };
}

async function getMemberInvite(queryable, groupId, userId) {
  const result = await queryable.query(
    `SELECT gi.id, gi.group_id, gi.user_id, gi.seat_id, gi.payment_status,
            s.seat_label, s.price, s.status AS slot_status
     FROM group_invites gi
     LEFT JOIN slots s ON s.id = gi.seat_id
     WHERE gi.group_id = $1 AND gi.user_id = $2`,
    [groupId, userId],
  );
  return result.rows[0] || null;
}

async function updateMemberPayment(client, groupId, userId, status) {
  await client.query(
    `UPDATE group_invites SET payment_status = $1
     WHERE group_id = $2 AND user_id = $3`,
    [status, groupId, userId],
  );
}

async function lockBookingGroup(client, groupId) {
  const result = await client.query(
    `SELECT id, event_id, leader_user_id, status, expires_at, invite_link_token
     FROM booking_groups
     WHERE id = $1
     FOR UPDATE`,
    [groupId],
  );
  return result.rows[0] || null;
}

async function allSeatedMembersPaid(client, groupId) {
  const result = await client.query(
    `SELECT COUNT(*) AS unpaid_count
     FROM group_invites
     WHERE group_id = $1 AND seat_id IS NOT NULL AND payment_status = 'pending'`,
    [groupId],
  );
  return parseInt(result.rows[0].unpaid_count, 10) === 0;
}

module.exports = {
  createGroup,
  addMemberToGroup,
  getMemberInvite,
  updateMemberPayment,
  lockBookingGroup,
  allSeatedMembersPaid,
};
