const { Server } = require("socket.io");

let io;

function initSocket(server) {
  const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);

    socket.on("join_event", ({ eventId }) => {
      if (eventId) {
        socket.join(eventId);
        console.log(`[SOCKET] ${socket.id} → joined event room: ${eventId}`);
      }
    });

    socket.on("join_group", ({ groupId }) => {
      if (groupId) {
        socket.join(groupId);
        console.log(`[SOCKET] ${socket.id} → joined group room: ${groupId}`);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[SOCKET] Client disconnected: ${socket.id} — reason: ${reason}`,
      );
    });
  });

  console.log("[SOCKET] Socket.io initialised");
  return io;
}

function getIO() {
  if (!io) {
    throw new Error(
      "[SOCKET] Socket.io not initialised. Call initSocket(server) first.",
    );
  }
  return io;
}

module.exports = { initSocket, getIO };
