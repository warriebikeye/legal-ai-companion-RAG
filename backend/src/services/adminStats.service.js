// services/adminStats.service.js

import mongoose from "mongoose";
import { ingestionQueue } from "../queue/ingestion.queue.js";
import User from "../models/User.js";
import redis from "./redis.js";

/* =========================================================
   LOGGER
========================================================= */

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[ADMIN_STATS] [${timestamp}] ${step}`, data)
    : console.log(`[ADMIN_STATS] [${timestamp}] ${step}`);
}

/* =========================================================
   CACHE KEY + TTL
   Stats are cached for 30s so rapid dashboard refreshes
   don't hammer MongoDB/BullMQ on every click.
========================================================= */

const STATS_CACHE_KEY = "admin:dashboard:stats";
const STATS_CACHE_TTL = 30; // seconds

/* =========================================================
   USER STATS
========================================================= */

async function getUserStats() {
  const [
    totalUsers,
    premiumUsers,
    enterpriseUsers,
    freeUsers,
    newThisWeek,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ subscriptionTier: "premium" }),
    User.countDocuments({ subscriptionTier: "enterprise" }),
    User.countDocuments({ subscriptionTier: "free" }),
    User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  return {
    total: totalUsers,
    premium: premiumUsers,
    enterprise: enterpriseUsers,
    free: freeUsers,
    newThisWeek,
    premiumPct: totalUsers
      ? Math.round((premiumUsers / totalUsers) * 100 * 10) / 10
      : 0,
  };
}

/* =========================================================
   RECENT USERS (for table)
========================================================= */

async function getRecentUsers(limit = 20, tier = null) {
  const filter = tier ? { subscriptionTier: tier } : {};

  const users = await User.find(filter)
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .limit(limit)
    .select(
      "name email subscriptionTier subscriptionStatus subscriptionPlan dailyRequestCount lastActiveAt lastRequestDate role createdAt"
    )
    .lean();

  return users.map((u) => ({
    id: u._id.toString(),
    name: u.name || u.email?.split("@")[0] || "Unknown",
    email: u.email,
    tier: u.subscriptionTier || "free",
    subscriptionStatus: u.subscriptionStatus || "inactive",
    subscriptionPlan: u.subscriptionPlan || null,
    dailyRequestCount: u.dailyRequestCount || 0,
    lastRequestDate: u.lastRequestDate || null,
    createdAt: u.createdAt,
    lastActiveAt: u.lastActiveAt || u.lastRequestDate || u.createdAt,
    role: u.role || "user",
  }));
}

/* =========================================================
   QUERY VOLUME — Hourly buckets (last 24h)
   Reads from the Message or Conversation collection.
   Adjust the model import to match your actual schema.
========================================================= */

async function getQueryVolume() {
  // Dynamic import so this file stays usable even if the
  // model path differs in your project.
  let Message;
  try {
    Message = (await import("../models/Message.js")).default;
  } catch {
    // Fall back to Conversation if Message model doesn't exist
    Message = (await import("../models/Conversation.js")).default;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const buckets = await Message.aggregate([
    {
      $match: {
        role: "user",
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%H:00",
            date: "$createdAt",
            timezone: "UTC",
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Fill all 24 hour slots so the chart has no gaps
  const hourMap = {};
  for (let h = 0; h < 24; h++) {
    const label = String(h).padStart(2, "0") + ":00";
    hourMap[label] = 0;
  }
  buckets.forEach((b) => {
    hourMap[b._id] = b.count;
  });

  const todayTotal = Object.values(hourMap).reduce((s, v) => s + v, 0);

  // Yesterday total for delta
  const yesterday = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const yesterdayTotal = await Message.countDocuments({
    role: "user",
    createdAt: { $gte: yesterday, $lt: since },
  });

  return {
    hourly: Object.entries(hourMap).map(([hour, count]) => ({
      hour,
      count,
    })),
    todayTotal,
    yesterdayTotal,
    deltaPercent: yesterdayTotal
      ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
      : null,
  };
}

/* =========================================================
   QUEUE STATS — from BullMQ
========================================================= */

async function getQueueStats() {
  const [waiting, active, delayed, failed, completed] = await Promise.all([
    ingestionQueue.getWaitingCount(),
    ingestionQueue.getActiveCount(),
    ingestionQueue.getDelayedCount(),
    ingestionQueue.getFailedCount(),
    ingestionQueue.getCompletedCount(),
  ]);

  const overloaded = waiting >= 40 || active >= 10;

  // Grab the 5 most recently failed jobs for the log panel
  const failedJobs = await ingestionQueue.getFailed(0, 4);
  const recentFailures = failedJobs.map((j) => ({
    id: j.id,
    name: j.name,
    failedReason: j.failedReason,
    timestamp: j.finishedOn
      ? new Date(j.finishedOn).toISOString()
      : null,
    attemptsMade: j.attemptsMade,
  }));

  return {
    waiting,
    active,
    delayed,
    failed,
    completed,
    overloaded,
    status: overloaded ? "overloaded" : "healthy",
    recentFailures,
  };
}

/* =========================================================
   LATENCY STATS — from Redis ring buffer
   The RAG service should write latency entries like:
     redis.lpush("metrics:latency", latencyMs)
     redis.ltrim("metrics:latency", 0, 499)   // keep last 500
   If that key doesn't exist yet we return null gracefully.
========================================================= */

async function getLatencyStats() {
  try {
    const raw = await redis.lrange("metrics:latency", 0, 499);
    if (!raw || raw.length === 0) return { avg: null, p95: null, p99: null, samples: 0 };

    const nums = raw.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    const avg = Math.round(nums.reduce((s, v) => s + v, 0) / nums.length);
    const p95 = nums[Math.floor(nums.length * 0.95)];
    const p99 = nums[Math.floor(nums.length * 0.99)];

    return { avg, p95, p99, samples: nums.length };
  } catch {
    return { avg: null, p95: null, p99: null, samples: 0 };
  }
}

/* =========================================================
   MODEL USAGE STATS — from Redis counters
   Increment these in gemini.js after each successful call:
     redis.hincrby("metrics:model_usage", modelName, 1)
========================================================= */

async function getModelUsageStats() {
  try {
    const raw = await redis.hgetall("metrics:model_usage");
    if (!raw) return { breakdown: [], total: 0 };

    const entries = Object.entries(raw).map(([model, count]) => ({
      model,
      count: Number(count),
    }));
    const total = entries.reduce((s, e) => s + e.count, 0);

    return {
      breakdown: entries
        .sort((a, b) => b.count - a.count)
        .map((e) => ({
          ...e,
          pct: total ? Math.round((e.count / total) * 100) : 0,
        })),
      total,
    };
  } catch {
    return { breakdown: [], total: 0 };
  }
}

/* =========================================================
   VIOLATION / CLAUSE REPORTS — from MongoDB
   Adjust model path to match your violationRoutes schema.
========================================================= */

async function getViolationStats() {
  let Violation;
  try {
    Violation = (await import("../models/Violation.js")).default;
  } catch {
    return { total: 0, recent: [] };
  }

  const [total, recent] = await Promise.all([
    Violation.countDocuments(),
    Violation.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("userId country severity createdAt")
      .lean(),
  ]);

  return { total, recent };
}

/* =========================================================
   SYSTEM HEALTH — MongoDB + Qdrant ping
========================================================= */

async function getSystemHealth() {
  const mongoState = mongoose.connection.readyState;

  // Qdrant: try a lightweight collections list call
  let qdrantOk = false;
  try {
    const { qdrant } = await import("../vectorstore/qdrant.js");
    await qdrant.getCollections();
    qdrantOk = true;
  } catch {
    qdrantOk = false;
  }

  // Redis ping
  let redisOk = false;
  try {
    const pong = await redis.ping();
    redisOk = pong === "PONG";
  } catch {
    redisOk = false;
  }

  return {
    mongodb: mongoState === 1 ? "connected" : "disconnected",
    qdrant: qdrantOk ? "connected" : "unreachable",
    redis: redisOk ? "connected" : "unreachable",
    uptime: Math.round(process.uptime()),
  };
}

/* =========================================================
   MASTER AGGREGATOR
   Runs all sub-queries in parallel, caches result for 30s.
========================================================= */

export async function getDashboardStats({ tier = null } = {}) {
  // Only cache the "all tiers" view; filtered views skip cache
  if (!tier) {
    const cached = await redis.get(STATS_CACHE_KEY);
    if (cached) {
      log("✅ Dashboard stats cache HIT");
      return typeof cached === "string" ? JSON.parse(cached) : cached;
    }
    log("❌ Dashboard stats cache MISS — computing");
  }

  const [
    users,
    recentUsers,
    queryVolume,
    queue,
    latency,
    modelUsage,
    violations,
    health,
  ] = await Promise.allSettled([
    getUserStats(),
    getRecentUsers(20, tier),
    getQueryVolume(),
    getQueueStats(),
    getLatencyStats(),
    getModelUsageStats(),
    getViolationStats(),
    getSystemHealth(),
  ]);

  const resolve = (result, fallback) =>
    result.status === "fulfilled" ? result.value : fallback;

  const stats = {
    generatedAt: new Date().toISOString(),
    users: resolve(users, {}),
    recentUsers: resolve(recentUsers, []),
    queryVolume: resolve(queryVolume, {}),
    queue: resolve(queue, {}),
    latency: resolve(latency, {}),
    modelUsage: resolve(modelUsage, {}),
    violations: resolve(violations, {}),
    health: resolve(health, {}),
  };

  if (!tier) {
    await redis.set(STATS_CACHE_KEY, JSON.stringify(stats), {
      ex: STATS_CACHE_TTL,
    });
    log("✅ Dashboard stats cached", { ttl: STATS_CACHE_TTL });
  }

  return stats;
}

/* =========================================================
   INVALIDATE CACHE (call after admin actions)
========================================================= */

export async function invalidateDashboardCache() {
  await redis.del(STATS_CACHE_KEY);
  log("🗑️ Dashboard cache invalidated");
}