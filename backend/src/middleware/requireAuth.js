// src/middleware/requireAuth.js
//
// Auth strategy (in order):
//   1. Passport session      — req.user already hydrated → pass through
//   2. ub_sess JWT cookie    — verify + load User from DB → attach req.user
//   3. Authorization: Bearer — same JWT, sent as a header instead of a
//                              cookie (used by the WebView-wrapped app,
//                              where cross-site cookies are unreliable)
//   4. None of the above     → 401

import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { SECURE_COOKIE_NAME } from "../utils/setAuthCookie.js";

async function loadUserFromToken(token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  return User.findById(payload.id).lean();
}

export async function requireAuth(req, res, next) {
  console.log("RequireAuth check:", {
    isAuthenticated: req.isAuthenticated?.(),
    user: req.user,
    cookies: req.headers.cookie,
    hasAuthHeader: !!req.headers.authorization,
  });

  // ── 1. Passport session ───────────────────────────────────
  if (req.isAuthenticated?.() && req.user) {
    return next();
  }

  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── 2. ub_sess JWT cookie ─────────────────────────────────
  const cookieToken = req.cookies?.[SECURE_COOKIE_NAME];
  if (cookieToken) {
    try {
      const user = await loadUserFromToken(cookieToken, secret);
      if (user) {
        req.user = user;
        console.log("RequireAuth: session cold, cookie JWT valid → user loaded", { userId: user._id });
        return next();
      }
    } catch (err) {
      console.warn("RequireAuth: cookie JWT verify failed →", err.message);
    }
  }

  // ── 3. Authorization: Bearer <token> ──────────────────────
  const authHeader  = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (bearerToken) {
    try {
      const user = await loadUserFromToken(bearerToken, secret);
      if (user) {
        req.user = user;
        console.log("RequireAuth: session cold, bearer JWT valid → user loaded", { userId: user._id });
        return next();
      }
    } catch (err) {
      console.warn("RequireAuth: bearer JWT verify failed →", err.message);
    }
  }

  // ── 4. Nothing worked ──────────────────────────────────────
  return res.status(401).json({ error: "Unauthorized" });
}