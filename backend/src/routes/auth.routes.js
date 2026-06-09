// src/routes/auth.routes.js
import { Router } from "express";
import passport from "passport";
import {
  googleCallback,
  me,
  logout, register, verifyEmail, login ,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register",      register);
router.post("/verify-email",  verifyEmail);
router.post("/login",         login);

/* =========================================================
   WEBVIEW USER-AGENT FIX
   
   Google blocks OAuth when it detects the Android WebView
   token ("; wv)") in the User-Agent string.
   
   This middleware runs before passport.authenticate() and
   replaces the WebView UA with a standard Chrome mobile UA
   so Google's OAuth endpoint accepts the request.
   
   Also handles the Intent URL fallback query param (?intent=1)
   sent by the frontend when it detects a WebView itself.
========================================================= */

const CHROME_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function fixWebViewUA(req, res, next) {
  const ua = req.headers["user-agent"] || "";

  // Detect Android WebView — Google checks for "; wv)" token
  const isAndroidWebView =
    /; wv\)/.test(ua) ||
    /wv/.test(ua) ||
    req.query.intent === "1"; // set by frontend openAuth util

  if (isAndroidWebView) {
    console.log("[AUTH] WebView detected — spoofing UA for Google OAuth", {
      original: ua,
      replaced: CHROME_MOBILE_UA,
    });
    req.headers["user-agent"] = CHROME_MOBILE_UA;
  }

  next();
}

/* =========================================================
   ROUTES
========================================================= */

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints (Google OAuth + session)
 */

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Start Google OAuth login
 *     tags: [Auth]
 *     description: >
 *       Redirects the user to Google for authentication.
 *       Includes WebView User-Agent fix for apps wrapped in
 *       Android WebView (AllAppPress etc).
 *       On success, Google redirects back to /auth/google/callback.
 *     parameters:
 *       - in: query
 *         name: intent
 *         schema:
 *           type: string
 *           enum: ["1"]
 *         description: Set by frontend when Android WebView is detected
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth consent screen
 */
router.get(
  "/google",
  fixWebViewUA,                                   // ← runs first, fixes UA
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [Auth]
 *     description: Google redirects here after authentication.
 *     responses:
 *       302:
 *         description: Redirect after login success or failure
 */
router.get("/google/callback", googleCallback);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current auth state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isAuthenticated:
 *                   type: boolean
 *                 userEmail:
 *                   type: string
 *                 subscriptionTier:
 *                   type: string
 */
router.get("/me", me);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout success
 */
router.post("/logout", logout);

export default router;