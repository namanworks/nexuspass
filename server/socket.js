const { Server } = require('socket.io');

/** @type {import('socket.io').Server} */
let io;

/**
 * Initialise Socket.io on the HTTP server.
 * Call this once in index.js after the HTTP server is created.
 * Returns the io instance so routes/workers can import getIO() instead.
 */
function initSocket(server) {
  // CLIENT_URL can be a comma-separated list for multiple origins
  // e.g. "https://nexuspass.vercel.app,http://localhost:3000"
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);

    // ── Client joins an event room ────────────────────────────────────────
    // All users viewing the same event share a room keyed by event_id.
    // Seat status changes are broadcast to this room.
    socket.on('join_event', ({ eventId }) => {
      if (eventId) {
        socket.join(eventId);
        console.log(`[SOCKET] ${socket.id} → joined event room: ${eventId}`);
      }
    });

    // ── Client joins a group room ─────────────────────────────────────────
    // All members of the same booking group share a room keyed by group_id.
    // Payment status updates are broadcast to this room.
    socket.on('join_group', ({ groupId }) => {
      if (groupId) {
        socket.join(groupId);
        console.log(`[SOCKET] ${socket.id} → joined group room: ${groupId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[SOCKET] Client disconnected: ${socket.id} — reason: ${reason}`);
    });
  });

  console.log('[SOCKET] Socket.io initialised');
  return io;
}

/**
 * Returns the active Socket.io server instance.
 * Throws if initSocket() has not been called yet.
 * Import and call getIO() inside routes and workers to emit events.
 */
function getIO() {
  if (!io) {
    throw new Error('[SOCKET] Socket.io not initialised. Call initSocket(server) first.');
  }
  return io;
}

module.exports = { initSocket, getIO };
