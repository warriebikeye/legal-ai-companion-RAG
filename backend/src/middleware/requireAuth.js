// src/middleware/requireAuth.js
//
// Auth strategy (in order):
//   1. Passport session  — req.user already hydrated → pass through
//   2. ub_sess JWT       — verify + load User from DB → attach req.user
//   3. Neither           → 401

import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { SECURE_COOKIE_NAME } from "../utils/setAuthCookie.js";

export async function requireAuth(req, res, next) {
  console.log("RequireAuth check:", {
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user,
    cookies: req.headers.cookie,
  });

  // ── 1. Passport session ───────────────────────────────────
  if (req.isAuthenticated?.() && req.user) {
    return next();
  }

  // ── 2. ub_sess JWT fallback ───────────────────────────────
  const secret = process.env.AUTH_COOKIE_SECRET;
  const token  = req.cookies?.[SECURE_COOKIE_NAME];

  if (!secret || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });

    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    req.user = user;
    console.log("RequireAuth: session cold, JWT valid → user loaded", { userId: user._id });
    return next();
  } catch (err) {
    console.warn("RequireAuth: JWT verify failed →", err.message);
    return res.status(401).json({ error: "Unauthorized" });
  }
}