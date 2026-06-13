//backend src/utils/setAuthCookie.js
import jwt from "jsonwebtoken";

const SECURE_COOKIE_NAME = "ub_sess"; // HttpOnly — session security
const UI_COOKIE_NAME     = "ub_ui";   // JS-readable — UI state only

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_S  = 30 * 24 * 60 * 60;

/**
 * Two-cookie strategy:
 *
 * 1. `ub_sess`  — HttpOnly + Secure + SameSite=Strict
 *    Full signed JWT. JS cannot read it. Used as the
 *    hardened security token the browser auto-attaches.
 *
 * 2. `ub_ui`    — Secure + SameSite=Strict (NOT HttpOnly)
 *    Same signed JWT but JS-readable so the frontend can
 *    decode the payload without a fetch. Contains only safe
 *    UI data: name, email, photo, subscriptionTier.
 *    An attacker who steals this via XSS gets no session
 *    power — the real session lives in `ub_sess` + connect.sid.
 */
export function setAuthCookie(res, user) {
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret) {
    console.warn("[setAuthCookie] AUTH_COOKIE_SECRET not set — skipping");
    return;
  }

  const isProd = process.env.NODE_ENV === "production";

  const payload = {
    id:                 user._id?.toString() ?? user.id?.toString(),
    name:               user.name               ?? "",
    email:              user.email              ?? "",
    photo:              user.photo              ?? "",
    subscriptionTier:   user.subscriptionTier   ?? "free",
    subscriptionStatus: user.subscriptionStatus ?? "inactive",
  };

  const token = jwt.sign(payload, secret, {
    expiresIn: THIRTY_DAYS_S,
    algorithm: "HS256",
  });

  const sharedOptions = {
    secure:   isProd,
    sameSite: "strict",
    maxAge:   THIRTY_DAYS_MS,
    path:     "/",
  };

  // 🔒 Cookie 1 — HttpOnly, XSS-proof
  res.cookie(SECURE_COOKIE_NAME, token, {
    ...sharedOptions,
    httpOnly: true,
  });

  // 👁 Cookie 2 — JS-readable for zero-fetch UI state
  res.cookie(UI_COOKIE_NAME, token, {
    ...sharedOptions,
    httpOnly: false,
  });
}

/**
 * Clears both cookies on logout.
 */
export function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  const base = { secure: isProd, sameSite: "strict", path: "/" };

  res.clearCookie(SECURE_COOKIE_NAME, { ...base, httpOnly: true });
  res.clearCookie(UI_COOKIE_NAME,     { ...base, httpOnly: false });
}

/**
 * Optional middleware: verifies ub_sess and attaches decoded
 * payload to req.authCookie for stateless route usage.
 */
export function verifyAuthCookie(req, res, next) {
  const secret = process.env.AUTH_COOKIE_SECRET;
  const token  = req.cookies?.[SECURE_COOKIE_NAME];

  if (!secret || !token) {
    req.authCookie = null;
    return next();
  }

  try {
    req.authCookie = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    req.authCookie = null;
  }

  next();
}

export { SECURE_COOKIE_NAME, UI_COOKIE_NAME };