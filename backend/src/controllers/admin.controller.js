// controllers/admin.controller.js

import {
  getDashboardStats,
  invalidateDashboardCache,
} from "../services/adminStats.service.js";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[ADMIN_CTRL] [${timestamp}] ${step}`, data)
    : console.log(`[ADMIN_CTRL] [${timestamp}] ${step}`);
}

/* =========================================================
   GET /admin/stats
   Query params:
     ?tier=free|premium|enterprise   (filter recentUsers)
     ?refresh=true                   (bust cache)
========================================================= */

export async function getDashboard(req, res) {
  const start = Date.now();

  try {
    const tier = req.query.tier || null;
    const bust = req.query.refresh === "true";

    log("Dashboard request", { tier, bust, adminId: req.user._id });

    if (bust) {
      await invalidateDashboardCache();
    }

    const stats = await getDashboardStats({ tier });

    log("Dashboard served", { durationMs: Date.now() - start });

    return res.json({
      ok: true,
      durationMs: Date.now() - start,
      ...stats,
    });
  } catch (err) {
    console.error("❌ ADMIN getDashboard error", {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
}

/* =========================================================
   GET /admin/users
   Thin wrapper for paginated user listing outside the
   dashboard (e.g. full user management page).
   Query params: ?tier= &page= &limit=
========================================================= */

export async function listUsers(req, res) {
  try {
    const tier = req.query.tier || null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const User = (await import("../models/User.js")).default;

    const filter = tier ? { subscriptionTier: tier } : {};
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("name email subscriptionTier subscriptionStatus subscriptionPlan dailyRequestCount lastActiveAt lastRequestDate role createdAt")
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name || u.email?.split("@")[0] || "Unknown",
        email: u.email,
        tier: u.subscriptionTier || "free",
        subscriptionStatus: u.subscriptionStatus || "inactive",
        subscriptionPlan: u.subscriptionPlan || null,
        dailyRequestCount: u.dailyRequestCount || 0,
        role: u.role || "user",
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt || u.lastRequestDate || u.createdAt,
      })),
    });
  } catch (err) {
    console.error("❌ ADMIN listUsers error", { message: err?.message });
    return res.status(500).json({ error: "Failed to fetch users" });
  }
}

/* =========================================================
   GET /admin/queue
   Live queue snapshot — not cached (always fresh).
========================================================= */

export async function getQueueStatus(req, res) {
  try {
    const { ingestionQueue } = await import("../queue/ingestion.queue.js");

    const [waiting, active, delayed, failed, completed] = await Promise.all([
      ingestionQueue.getWaitingCount(),
      ingestionQueue.getActiveCount(),
      ingestionQueue.getDelayedCount(),
      ingestionQueue.getFailedCount(),
      ingestionQueue.getCompletedCount(),
    ]);

    const failedJobs = await ingestionQueue.getFailed(0, 9);

    return res.json({
      ok: true,
      queue: {
        waiting,
        active,
        delayed,
        failed,
        completed,
        overloaded: waiting >= 40 || active >= 10,
        status: waiting >= 40 || active >= 10 ? "overloaded" : "healthy",
      },
      recentFailures: failedJobs.map((j) => ({
        id: j.id,
        name: j.name,
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
        timestamp: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error("❌ ADMIN getQueueStatus error", { message: err?.message });
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
}

/* =========================================================
   POST /admin/queue/retry/:jobId
   Retry a specific failed job.
========================================================= */

export async function retryJob(req, res) {
  try {
    const { ingestionQueue } = await import("../queue/ingestion.queue.js");
    const { jobId } = req.params;

    const job = await ingestionQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    await job.retry();
    log("Job retried by admin", { jobId, adminId: req.user._id });

    return res.json({ ok: true, message: `Job ${jobId} queued for retry` });
  } catch (err) {
    console.error("❌ ADMIN retryJob error", { message: err?.message });
    return res.status(500).json({ error: "Failed to retry job" });
  }
}