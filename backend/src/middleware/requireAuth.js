// src/middleware/requireAuth.js
export function requireAuth(req, res, next) {
  console.log("RequireAuth check:", {
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user,
    cookies: req.headers.cookie
  });

  if (req.isAuthenticated?.() && req.user) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

