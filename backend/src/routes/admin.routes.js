// routes/admin.routes.js

import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";// reuse your existing auth check
import { isAdmin } from "../middleware/isAdmin.middleware.js";
import {
  getDashboard,
  listUsers,
  getQueueStatus,
  retryJob,
} from "../controllers/admin.controller.js";

const router = express.Router();

// All admin routes require auth + admin role
//router.use(isAuthenticated, isAdmin);

/* =========================================================
   DASHBOARD
========================================================= */

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Full dashboard stats snapshot
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [free, premium, enterprise]
 *         description: Filter recent users by subscription tier
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         description: Pass "true" to bust the 30s Redis cache
 *     responses:
 *       200:
 *         description: Dashboard stats object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin only
 */
router.get("/stats",requireAuth, getDashboard);

/* =========================================================
   USERS
========================================================= */

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: Paginated user list
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [free, premium, enterprise]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Paginated users array
 */
router.get("/users",requireAuth, listUsers);

/* =========================================================
   QUEUE
========================================================= */

/**
 * @swagger
 * /admin/queue:
 *   get:
 *     summary: Live BullMQ queue status (not cached)
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Queue counts + recent failed jobs
 */
router.get("/queue",requireAuth, getQueueStatus);

/**
 * @swagger
 * /admin/queue/retry/{jobId}:
 *   post:
 *     summary: Retry a failed ingestion job
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job queued for retry
 *       404:
 *         description: Job not found
 */
router.post("/queue/retry/:jobId",requireAuth, retryJob);

export default router;