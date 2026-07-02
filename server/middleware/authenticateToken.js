const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = req.cookies?.token;
  }

  if (!token) {
    return res.status(401).json({
      error: true,
      message: "Authentication required. No token provided.",
      code: "UNAUTHENTICATED",
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
      message: "Invalid or expired token. Please log in again.",
      code: "UNAUTHENTICATED",
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({
      error: true,
      message: "Access forbidden. Admin privileges required.",
      code: "FORBIDDEN",
    });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin };
