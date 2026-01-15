// src/routes/auth.routes.js
import { Router } from "express";
import { googleAuth, googleCallback, me, logout } from "../controllers/auth.controller.js";

const router = Router();

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
 *     description: Redirects the user to Google for authentication. On success, Google redirects back to /auth/google/callback.
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth consent screen
 */
router.get("/google", googleAuth);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [Auth]
 *     description: Google redirects here after authentication. Creates a session and redirects to /dashboard (or your configured page).
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
 *     description: Returns the current session authentication status and user object (if logged in).
 *     responses:
 *       200:
 *         description: Current auth state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authenticated:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   nullable: true
 *                   description: Passport user object stored in session
 *       401:
 *         description: Not authenticated (only if you later choose to protect this route)
 */
router.get("/me", me);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Auth]
 *     description: Destroys the current session and clears the session cookie.
 *     responses:
 *       200:
 *         description: Logout success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 */
router.post("/logout", logout);

export default router;
