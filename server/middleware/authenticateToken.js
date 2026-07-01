const jwt = require('jsonwebtoken');

/**
 * Middleware: reads JWT from httpOnly cookie, verifies it,
 * and attaches req.user = { userId, email, isAdmin } on success.
 */
function authenticateToken(req, res, next) {
  const token = req.cookies?.token;

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
