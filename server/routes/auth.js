const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireFields, sanitizeString } = require('../middleware/validateInput');

const router = express.Router();

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
router.post(
  '/register',
  requireFields('name', 'email', 'password'),
  async (req, res, next) => {
    try {
      const name = sanitizeString(req.body.name);
      const email = sanitizeString(req.body.email).toLowerCase();
      const { password } = req.body;

      // Check for duplicate email
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          error: true,
          message: 'An account with this email already exists.',
          code: 'VALIDATION_ERROR',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, is_admin)
         VALUES ($1, $2, $3, false)
         RETURNING id, email, name`,
        [name, email, passwordHash]
      );

      const user = result.rows[0];

      return res.status(201).json({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          name: user.name,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
router.post(
  '/login',
  requireFields('email', 'password'),
  async (req, res, next) => {
    try {
      const email = sanitizeString(req.body.email).toLowerCase();
      const { password } = req.body;

      const result = await pool.query(
        'SELECT id, email, name, password_hash, is_admin FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: true,
          message: 'No account found with this email.',
          code: 'NOT_FOUND',
        });
      }

      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        return res.status(401).json({
          error: true,
          message: 'Incorrect password.',
          code: 'UNAUTHENTICATED',
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      // sameSite: 'none' + secure: true are REQUIRED for cross-origin cookies
      // (Vercel frontend → Railway backend). Both must be set together or browsers
      // will silently block the cookie. NODE_ENV must be 'production' on Railway.
      const isProduction = process.env.NODE_ENV === 'production';
      if (!isProduction) {
        console.warn('[AUTH] NODE_ENV is not "production". Cookie will NOT work cross-origin (Vercel → Railway). Set NODE_ENV=production in Railway environment variables.');
      }
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      });

      return res.status(200).json({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          // Token is returned in the body for Bearer auth (cross-origin SPA deployments).
          // The httpOnly cookie above is kept as a fallback for local dev.
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.status(200).json({
    success: true,
    data: { message: 'Logged out successfully.' },
  });
});

module.exports = router;
