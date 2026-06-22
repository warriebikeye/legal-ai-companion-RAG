// src/utils/onesignal.js
//
// Thin wrapper around the OneSignal REST API.
// Uses include_aliases.external_id (user-centric model — NOT legacy player IDs).
// Store these in Render env vars:
//   ONESIGNAL_APP_ID      — from OneSignal Settings → Keys & IDs
//   ONESIGNAL_REST_API_KEY — from OneSignal Settings → Keys & IDs

const ONESIGNAL_API = "https://onesignal.com/api/v1/notifications";

/**
 * Send a push notification to a specific user by their email (external_id).
 *
 * @param {object} options
 * @param {string}  options.externalId  — the email passed to median.onesignal.login()
 * @param {string}  options.title       — notification heading
 * @param {string}  options.body        — notification message
 * @param {string} [options.targetUrl]  — deep-link path inside the app (e.g. "/chat")
 * @param {object} [options.data]       — extra key/value data payload (optional)
 */
export async function sendPushNotification({ externalId, title, body, targetUrl, data }) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    console.warn("[OneSignal] Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY — skipping push.");
    return null;
  }

  if (!externalId) {
    console.warn("[OneSignal] No externalId provided — skipping push.");
    return null;
  }

  const payload = {
    app_id: appId,
    // user-centric targeting — matches whatever was passed to median.onesignal.login()
    include_aliases: { external_id: [externalId] },
    target_channel: "push",
    headings: { en: title },
    contents: { en: body },
    ...(targetUrl && { url: targetUrl }),
    ...(data && { data }),
  };

  try {
    const res = await fetch(ONESIGNAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error("[OneSignal] Push failed:", result);
      return null;
    }

    console.log(`[OneSignal] Push sent to ${externalId}:`, result.id);
    return result;

  } catch (err) {
    console.error("[OneSignal] Network error:", err.message);
    return null;
  }
}

/**
 * Send the daily query reset notification to a single user.
 * Called from the daily-reset cron job after resetting their quota.
 */
export async function sendDailyResetNotification(userEmail) {
  return sendPushNotification({
    externalId: userEmail,
    title: "Your queries have reset 🔄",
    body: "Your daily legal queries are ready. Ask Clauzify anything.",
    targetUrl: "/",
    data: { type: "daily_reset" },
  });
}

/**
 * Send a welcome notification to a brand-new user after they verify their email.
 * Optional — gives new users a warm first impression.
 */
export async function sendWelcomeNotification(userEmail, userName) {
  return sendPushNotification({
    externalId: userEmail,
    title: `Welcome to Clauzify, ${userName?.split(" ")[0] || "there"} 👋`,
    body: "Africa's legal intelligence is ready for your first question.",
    targetUrl: "/",
    data: { type: "welcome" },
  });
}