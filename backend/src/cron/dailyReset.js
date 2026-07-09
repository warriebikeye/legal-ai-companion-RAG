// src/cron/dailyReset.js
import cron from "node-cron";
import User from "../models/User.js";
import { sendDailyResetNotification } from "../utils/onesignal.js";
import { FREE_DAILY_TOKENS } from "../config/tokens.js";

export async function runDailyReset() {
  const start = Date.now();
  console.log("[DailyReset] Starting daily free token reset...");

  try {
    // Reset all verified users, regardless of whether they used their free tokens today
    const usersToReset = await User.find({
      isVerified: true,
    }).select("email name dailyFreeTokens");

    console.log(`[DailyReset] Found ${usersToReset.length} users to reset.`);

    let resetCount  = 0;
    let notifyCount = 0;

    for (const user of usersToReset) {
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              dailyFreeTokens: FREE_DAILY_TOKENS,
              lastFreeReset:   new Date(),
            },
          }
        );
        resetCount++;

        const pushResult = await sendDailyResetNotification(user.email);
        if (pushResult) notifyCount++;

      } catch (userErr) {
        console.error(`[DailyReset] Failed for ${user.email}:`, userErr.message);
      }
    }

    const duration = Date.now() - start;
    console.log(
      `[DailyReset] Done in ${duration}ms — Reset: ${resetCount}, Notified: ${notifyCount}/${usersToReset.length}`
    );

  } catch (err) {
    console.error("[DailyReset] Fatal error:", err.message);
  }
}

export function scheduleDailyReset() {
  // TEMP: every 2 minutes for push notification testing.
  // Revert to "0 0 * * *" (midnight WAT) once confirmed working.
  // Token expiry cron runs separately at 01:00 WAT — see cron/tokenExpiry.js
  cron.schedule("*/2 * * * *", runDailyReset, {
    timezone: "Africa/Lagos",
  });
  console.log("[DailyReset] Cron scheduled — runs every 2 minutes (TEMP testing mode).");
}