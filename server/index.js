require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const http = require("http");

const { defaultLimiter } = require("./middleware/rateLimiter");
const { initSocket } = require("./socket");
const { startExpiryWorker } = require("./workers/expiryWorker");

const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const bookingRoutes = require("./routes/bookings");
const groupRoutes = require("./routes/groups");
const resaleRoutes = require("./routes/resale");
const ticketRoutes = require("./routes/tickets");
const verifyRoutes = require("./routes/verify");

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: (origin, callback) => {
      const clientUrls = (process.env.CLIENT_URL || "http://localhost:3000")
        .split(",")
        .map((url) => url.trim());

      const allowed = [
        ...clientUrls,
        "http://localhost:3000",
        "http://localhost:3001",
      ];
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use("/api", defaultLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/resale", resaleRoutes);
app.use("/api/verify", verifyRoutes);

app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: { status: "ok", timestamp: new Date().toISOString() },
  });
});

app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  res.status(500).json({
    error: true,
    message: "An unexpected server error occurred.",
    code: "SERVER_ERROR",
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(
    `[SERVER] NexusPass API running on port ${PORT} (${process.env.NODE_ENV || "development"})`,
  );
  console.log(
    `[SERVER] CLIENT_URL: ${process.env.CLIENT_URL || "http://localhost:3000"}`,
  );
  initSocket(server);
  startExpiryWorker();
});

module.exports = { app, server };
