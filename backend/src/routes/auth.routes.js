// src/routes/auth.routes.js
import { Router } from "express";
import passport from "passport";
import multer from "multer";
import {
  googleCallback,
  me,
  logout,
  register,
  verifyEmail,
  login,
  updateProfile,
  uploadAvatarHandler,
  requestPasswordChange,
  confirmPasswordChange,
} from "../controllers/auth.controller.js";
import {
  authRateLimiter,
  meLimiter,
} from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

/* ─── Avatar upload — memory storage, streamed straight to
   Cloudinary (no temp files on disk) ─── */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

/* =========================================================
   EMAIL / PASSWORD AUTH
========================================================= */

router.post("/register",     authRateLimiter, register);
router.post("/verify-email", authRateLimiter, verifyEmail);
router.post("/login",        authRateLimiter, login);

/* =========================================================
   WEBVIEW USER-AGENT FIX
========================================================= */

const CHROME_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function fixWebViewUA(req, res, next) {
  const ua = req.headers["user-agent"] || "";

  const isAndroidWebView =
    /; wv\)/.test(ua) ||
    /wv/.test(ua) ||
    req.query.intent === "1";

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
   GOOGLE OAUTH
========================================================= */

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints (Email/Password + Google OAuth)
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
 *       Android WebView. On success, Google redirects back
 *       to /auth/google/callback.
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
  fixWebViewUA,
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

/* =========================================================
   SESSION
========================================================= */

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
router.get("/me", meLimiter, me);

/**
 * @swagger
 * /auth/profile:
 *   put:
 *     summary: Update the current user's profile (name, avatar)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstname:
 *                 type: string
 *               lastname:
 *                 type: string
 *               photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated profile
 *       401:
 *         description: Unauthorized
 */
router.put("/profile", requireAuth, updateProfile);

/**
 * @swagger
 * /auth/password/request:
 *   post:
 *     summary: Start a password change — verifies current password, emails a confirmation code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Confirmation code emailed
 *       400:
 *         description: Validation error (weak password, no password set, same as old)
 *       401:
 *         description: Current password incorrect, or unauthenticated
 */
router.post("/password/request", authRateLimiter, requireAuth, requestPasswordChange);

/**
 * @swagger
 * /auth/password/confirm:
 *   post:
 *     summary: Finish a password change with the emailed confirmation code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: No pending change, or code expired
 *       401:
 *         description: Invalid code, or unauthenticated
 */
router.post("/password/confirm", authRateLimiter, requireAuth, confirmPasswordChange);

/**
 * @swagger
 * /auth/avatar:
 *   post:
 *     summary: Upload a new avatar image (multipart/form-data, field name "avatar")
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Uploaded avatar URL
 *       400:
 *         description: Missing or invalid image
 *       401:
 *         description: Unauthorized
 */
router.post("/avatar", requireAuth, (req, res, next) => {
  avatarUpload.single("avatar")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    next();
  });
}, uploadAvatarHandler);

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