function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(
      (field) =>
        req.body[field] === undefined ||
        req.body[field] === null ||
        req.body[field] === "",
    );

    if (missing.length > 0) {
      return res.status(400).json({
        error: true,
        message: `Missing required fields: ${missing.join(", ")}`,
        code: "VALIDATION_ERROR",
      });
    }

    next();
  };
}

function sanitizeString(str) {
  if (typeof str !== "string") return str;
  return str.trim();
}

module.exports = { requireFields, sanitizeString };
