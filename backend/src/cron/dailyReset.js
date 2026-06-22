// src/cron/dailyReset.js
//
// Runs at midnight (Africa/Lagos timezone) every day.
// Resets each free user's daily query count in MongoDB,
// then sends a push notification via OneSignal so they know
// their queries are ready — even if the app is closed.
//
// Required env vars (set on Render):
//   ONESIGNAL_APP_ID
//   ONESIGNAL_REST_API_KEY

import cron from "node-cron";
import User from "../models/User.js";
import { sendDailyResetNotification } from "../utils/onesignal.js";

/**
 * Reset daily queries for all free-tier users and notify them.
 * Exported so it can be called manually for testing.
 */
export async function runDailyReset() {
  const start = Date.now();
  console.log("[DailyReset] Starting daily query reset...");

  try {
    // Find all free users who have used at least 1 query today
    // Adjust the field name to match your User schema (e.g. dailyQueryCount, queriesUsed, etc.)
    const usersToReset = await User.find({
      subscriptionTier: "free",
      dailyRequestCount: { $gt: 0 },
      isVerified: true,
    }).select("email name dailyRequestCount");

    console.log(`[DailyReset] Found ${usersToReset.length} users to reset.`);

    let resetCount = 0;
    let notifyCount = 0;

    for (const user of usersToReset) {
      try {
        // 1. Reset their quota in MongoDB
        await User.updateOne(
          { _id: user._id },
          { $set: { dailyRequestCount: 0 } }
        );
        resetCount++;

        // 2. Send push notification (non-blocking — don't let one failure stop the rest)
        const pushResult = await sendDailyResetNotification(user.email);
        if (pushResult) notifyCount++;

      } catch (userErr) {
        // Log but continue — one user failing shouldn't abort the whole batch
        console.error(`[DailyReset] Failed for user ${user.email}:`, userErr.message);
      }
    }

    const duration = Date.now() - start;
    console.log(
      `[DailyReset] Done in ${duration}ms. Reset: ${resetCount}, Notified: ${notifyCount}/${usersToReset.length}`
    );

  } catch (err) {
    console.error("[DailyReset] Fatal error:", err.message);
  }
}

/**
 * Schedule the cron job.
 * Call this once from your app entry point (e.g. server.js / app.js):
 *
 *   import { scheduleDailyReset } from "./cron/dailyReset.js";
 *   scheduleDailyReset();
 */
export function scheduleDailyReset() {
  // Runs at 00:00 WAT (UTC+1) every day
  // Cron format: second(optional) minute hour day month weekday
  cron.schedule(
    "0 0 * * *",          // midnight every day
    runDailyReset,
    {
      timezone: "Africa/Lagos",  // WAT — correct for Nigeria, Ghana (GMT), Kenya adjust below
      // For Kenya (EAT, UTC+3): use "Africa/Nairobi"
      // For South Africa (SAST, UTC+2): use "Africa/Johannesburg"
      // For a universal midnight-UTC run (covers all): use "UTC"
    }
  );
  console.log("[DailyReset] Cron scheduled — runs at midnight WAT daily.");
}