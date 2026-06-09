// src/middleware/requireAdmin.js
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied." });
  }
  next();
}