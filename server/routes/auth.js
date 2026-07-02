const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const {
  requireFields,
  sanitizeString,
} = require("../middleware/validateInput");

const router = express.Router();

router.post(
  "/register",
  requireFields("name", "email", "password"),
  async (req, res, next) => {
    try {
      const name = sanitizeString(req.body.name);
      const email = sanitizeString(req.body.email).toLowerCase();
      const { password } = req.body;

      const existing = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          error: true,
          message: "An account with this email already exists.",
          code: "VALIDATION_ERROR",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, is_admin)
         VALUES ($1, $2, $3, false)
         RETURNING id, email, name`,
        [name, email, passwordHash],
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
  },
);

router.post(
  "/login",
  requireFields("email", "password"),
  async (req, res, next) => {
    try {
      const email = sanitizeString(req.body.email).toLowerCase();
      const { password } = req.body;

      const result = await pool.query(
        "SELECT id, email, name, password_hash, is_admin FROM users WHERE email = $1",
        [email],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: true,
          message: "No account found with this email.",
          code: "NOT_FOUND",
        });
      }

      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatch) {
        return res.status(401).json({
          error: true,
          message: "Incorrect password.",
          code: "UNAUTHENTICATED",
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      const isProduction = process.env.NODE_ENV === "production";
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.status(200).json({
    success: true,
    data: { message: "Logged out successfully." },
  });
});

module.exports = router;
