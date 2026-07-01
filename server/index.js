require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');

const { defaultLimiter } = require('./middleware/rateLimiter');
const { initSocket } = require('./socket');
const { startExpiryWorker } = require('./workers/expiryWorker');

// ── Route modules ──────────────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const eventRoutes   = require('./routes/events');
const bookingRoutes = require('./routes/bookings');

// Phase 3 — Group Booking
const groupRoutes   = require('./routes/groups');
// Phase 4 — Resale Marketplace
const resaleRoutes  = require('./routes/resale');
// Phase 5 — Tickets & Verify
const ticketRoutes  = require('./routes/tickets');
const verifyRoutes  = require('./routes/verify');

const app    = express();
const server = http.createServer(app);

// ─────────────────────────────────────────────
// Core Middleware
// ─────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests from any localhost port (dev) or the configured CLIENT_URL
      const clientUrls = (process.env.CLIENT_URL || 'http://localhost:3000')
        .split(',')
        .map(url => url.trim());
        
      const allowed = [
        ...clientUrls,
        'http://localhost:3000',
        'http://localhost:3001',
      ];
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true, // Required for httpOnly cookies to be sent cross-origin
  })
);
app.use(express.json());
app.use(cookieParser());

// ─────────────────────────────────────────────
// Rate Limiting — global default on all API routes
// ─────────────────────────────────────────────
app.use('/api', defaultLimiter);

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/events',   eventRoutes);
app.use('/api/bookings', bookingRoutes);

app.use('/api/groups',  groupRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/resale',  resaleRoutes);
app.use('/api/verify',  verifyRoutes);

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: true,
    message: 'An unexpected server error occurred.',
    code: 'SERVER_ERROR',
  });
});

// ─────────────────────────────────────────────
// Start Server + Socket.io + Workers
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`[SERVER] NexusPass API running on http://localhost:${PORT}`);

  // Initialise Socket.io after server starts listening
  initSocket(server);

  // Start background workers
  startExpiryWorker();
});

module.exports = { app, server };
