const rateLimit = require("express-rate-limit");

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: "Too many requests. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

const reserveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: "Too many reservation attempts. Please slow down.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

module.exports = { defaultLimiter, reserveLimiter };
