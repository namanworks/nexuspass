const jwt = require('jsonwebtoken');

/**
 * Middleware: reads JWT from the Authorization: Bearer header (primary)
 * or from an httpOnly cookie (fallback for backward compatibility).
 * Attaches req.user = { userId, email, isAdmin } on success.
 *
 * NOTE: Bearer header is the preferred approach for cross-origin deployments
 * (e.g. Vercel frontend → Railway backend) because browsers block third-party
 * cookies by default, even with SameSite=None; Secure.
 */
function authenticateToken(req, res, next) {
  // 1. Try Authorization: Bearer <token> header first
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7); // strip "Bearer "
  } else {
    // 2. Fall back to httpOnly cookie (local dev)
    token = req.cookies?.token;
  }

  if (!token) {
    return res.status(401).json({
      error: true,
      message: 'Authentication required. No token provided.',
      code: 'UNAUTHENTICATED',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      isAdmin: decoded.isAdmin || false,
    };
    next();
  } catch (err) {
    return res.status(401).json({
      error: true,
      message: 'Invalid or expired token. Please log in again.',
      code: 'UNAUTHENTICATED',
    });
  }
}

/**
 * Middleware: requires the authenticated user to be an admin.
 * Must be used after authenticateToken.
 */
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: true,
      message: 'Access forbidden. Admin privileges required.',
      code: 'FORBIDDEN',
    });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin };
