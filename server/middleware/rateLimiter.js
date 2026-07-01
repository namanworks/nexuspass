const rateLimit = require('express-rate-limit');

/**
 * Default limiter: 100 requests per 15 minutes.
 * Applied to all /api/* routes.
 */
const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: 'Too many requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Strict limiter: 10 requests per 15 minutes.
 * Applied only to POST /api/bookings/reserve to prevent seat-hammering.
 */
const reserveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: 'Too many reservation attempts. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

module.exports = { defaultLimiter, reserveLimiter };
