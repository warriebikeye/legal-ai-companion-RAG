// ─── HOW TO WIRE THE ADMIN ENDPOINT INTO YOUR SERVER ────────────────────────
//
// 1.  Copy files into your project
//     ┌─────────────────────────────────────────────────────────┐
//     │  middleware/isAdmin.middleware.js   (new)               │
//     │  services/adminStats.service.js    (new)               │
//     │  controllers/admin.controller.js   (new)               │
//     │  routes/admin.routes.js            (new)               │
//     │  utils/metrics.js                  (new)               │
//     └─────────────────────────────────────────────────────────┘
//
// 2.  Add the route in server.js (after your existing routes)
//
//     import adminRoutes from "./routes/admin.routes.js";
//     ...
//     app.use("/admin", adminRoutes);
//
// 3.  Add the role field to your User model if it doesn't exist
//
//     role: {
//       type: String,
//       enum: ["user", "admin"],
//       default: "user",
//     }
//
//     Then set role: "admin" on your admin user in MongoDB:
//     db.users.updateOne({ email: "you@example.com" }, { $set: { role: "admin" } })
//
// 4.  Add lastActiveAt to your User model (optional but recommended)
//     Update it on every authenticated request via middleware:
//
//     // middleware/trackActivity.middleware.js
//     export async function trackActivity(req, res, next) {
//       if (req.user?._id) {
//         User.findByIdAndUpdate(req.user._id, { lastActiveAt: new Date() })
//           .exec()
//           .catch(() => {});   // fire-and-forget
//       }
//       next();
//     }
//
//     // server.js — add after passport.session()
//     import { trackActivity } from "./middleware/trackActivity.middleware.js";
//     app.use(trackActivity);
//
// 5.  Instrument metrics — add two lines to gemini.js getAnswer()
//
//     import { trackModelCall, trackLatency } from "../utils/metrics.js";
//
//     // inside try block, after `const response = result?.response?.text?.() || ""`
//     trackModelCall(modelName);          // fire-and-forget
//     trackLatency(Date.now() - started); // fire-and-forget
//
// 6.  Wire the dashboard frontend to poll /admin/stats
//
//     The dashboard widget polls this endpoint.  For the React artifact,
//     replace the mock data fetch with:
//
//     const res = await fetch("/admin/stats?refresh=true", { credentials: "include" });
//     const data = await res.json();
//
//     Suggested poll interval: 30s (matches cache TTL).
//     For the queue panel alone: GET /admin/queue every 10s (uncached).
//
// ─── ENDPOINT SUMMARY ────────────────────────────────────────────────────────
//
//   GET  /admin/stats               Full dashboard snapshot (30s cache)
//   GET  /admin/stats?tier=premium  Same but recentUsers filtered by tier
//   GET  /admin/stats?refresh=true  Bust cache and recompute
//   GET  /admin/users               Paginated user list (?tier= &page= &limit=)
//   GET  /admin/queue               Live queue counts (no cache)
//   POST /admin/queue/retry/:jobId  Retry a failed BullMQ job
//
// ─── RESPONSE SHAPE: GET /admin/stats ────────────────────────────────────────
//
// {
//   ok: true,
//   generatedAt: "2025-06-06T14:32:00.000Z",
//   durationMs: 142,
//   users: {
//     total: 2841, premium: 389, enterprise: 0, free: 2452,
//     newThisWeek: 142, premiumPct: 13.7
//   },
//   recentUsers: [
//     { id, name, email, tier, country, createdAt, lastActiveAt, role }
//   ],
//   queryVolume: {
//     hourly: [{ hour: "00:00", count: 38 }, ...],   // 24 entries
//     todayTotal: 4182,
//     yesterdayTotal: 3543,
//     deltaPercent: 18
//   },
//   queue: {
//     waiting: 12, active: 3, delayed: 2, failed: 1, completed: 7821,
//     overloaded: false, status: "healthy",
//     recentFailures: [{ id, name, failedReason, attemptsMade, timestamp }]
//   },
//   latency: { avg: 1400, p95: 2100, p99: 3800, samples: 500 },
//   modelUsage: {
//     total: 4182,
//     breakdown: [
//       { model: "gemini-2.5-flash", count: 2843, pct: 68 },
//       { model: "gemini-2.5-pro",   count: 1171, pct: 28 },
//       { model: "gemini-embedding-001", count: 168, pct: 4 }
//     ]
//   },
//   violations: { total: 23, recent: [...] },
//   health: { mongodb: "connected", qdrant: "connected", redis: "connected", uptime: 86400 }
// }