// src/utils/onesignal.js
const ONESIGNAL_API = "https://onesignal.com/api/v1/notifications";

/* =========================================================
   CORE SEND FUNCTION
========================================================= */
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
    app_id:          appId,
    include_aliases: { external_id: [externalId] },
    target_channel:  "push",
    headings:        { en: title },
    contents:        { en: body },
    ...(targetUrl && { url: targetUrl }),
    ...(data      && { data }),
  };

  try {
    const res = await fetch(ONESIGNAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Basic ${apiKey}`,
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

/* =========================================================
   DAILY RESET NOTIFICATION
========================================================= */
export async function sendDailyResetNotification(userEmail) {
  return sendPushNotification({
    externalId: userEmail,
    title:      "Your queries have reset 🔄",
    body:       "Your daily legal queries are ready. Ask Clauzify anything.",
    targetUrl:  "/",
    data:       { type: "daily_reset" },
  });
}

/* =========================================================
   WELCOME NOTIFICATION
========================================================= */
export async function sendWelcomeNotification(userEmail, userName) {
  return sendPushNotification({
    externalId: userEmail,
    title:      `Welcome to Clauzify, ${userName?.split(" ")[0] || "there"} 👋`,
    body:       "Africa's legal intelligence is ready for your first question.",
    targetUrl:  "/",
    data:       { type: "welcome" },
  });
}

/* =========================================================
   TOKEN EXPIRY WARNING NOTIFICATION — Phase 5
========================================================= */
export async function sendTokenExpiryWarningPush(userEmail, tokens, daysLeft) {
  return sendPushNotification({
    externalId: userEmail,
    title:      `⏳ ${tokens} tokens expiring in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
    body:       "Use your tokens before they expire — ask a legal question or review a contract now.",
    targetUrl:  "/",
    data:       { type: "token_expiry_warning", tokens, daysLeft },
  });
}