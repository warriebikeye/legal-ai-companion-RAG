// src/utils/onesignal.js
const ONESIGNAL_API = "https://onesignal.com/api/v1/notifications";

/* =========================================================
   CORE SEND FUNCTION
========================================================= */
export async function sendPushNotification({ externalId, title, body, targetUrl, data }) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  console.log(`[OneSignal] ── sendPushNotification ──────────────────`);
  console.log(`[OneSignal] externalId : ${externalId}`);
  console.log(`[OneSignal] title      : ${title}`);
  console.log(`[OneSignal] body       : ${body}`);
  console.log(`[OneSignal] targetUrl  : ${targetUrl ?? "none"}`);
  console.log(`[OneSignal] data       : ${data ? JSON.stringify(data) : "none"}`);
  console.log(`[OneSignal] appId      : ${appId ? appId.slice(0, 8) + "..." : "MISSING"}`);
  console.log(`[OneSignal] apiKey     : ${apiKey ? apiKey.slice(0, 6) + "..." : "MISSING"}`);

  if (!appId || !apiKey) {
    console.warn("[OneSignal] ❌ Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY — skipping push.");
    return null;
  }

  if (!externalId) {
    console.warn("[OneSignal] ❌ No externalId provided — skipping push.");
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

  console.log(`[OneSignal] Sending payload:`, JSON.stringify(payload, null, 2));

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

    console.log(`[OneSignal] Response status : ${res.status}`);
    console.log(`[OneSignal] Response body   :`, JSON.stringify(result, null, 2));

    if (!res.ok) {
      console.error(`[OneSignal] ❌ Push FAILED for ${externalId}:`, result);
      return null;
    }

    // OneSignal returns recipients: 0 when externalId has no matching subscription
    if (result.recipients === 0) {
      console.warn(`[OneSignal] ⚠️ Push sent but 0 recipients matched for externalId: ${externalId}`);
      console.warn(`[OneSignal] ⚠️ This means the user has no active subscription linked to this email.`);
      console.warn(`[OneSignal] ⚠️ Check OneSignal Audience → Subscriptions and confirm the external_id matches exactly.`);
      return result;
    }

    console.log(`[OneSignal] ✅ Push delivered to ${result.recipients} recipient(s) for ${externalId}. Notification ID: ${result.id}`);
    return result;

  } catch (err) {
    console.error(`[OneSignal] ❌ Network error sending to ${externalId}:`, err.message);
    return null;
  }
}

/* =========================================================
   DAILY RESET NOTIFICATION
========================================================= */
export async function sendDailyResetNotification(userEmail) {
  console.log(`[OneSignal] → sendDailyResetNotification(${userEmail})`);
  return sendPushNotification({
    externalId: userEmail,
    title:      "Your queries have reset 🔄",
    body:       "Your daily legal queries are ready. Ask Clauzify anything.",
    targetUrl: "https://legal-ai-companion-rag-fr.onrender.com",
    data:       { type: "daily_reset" },
  });
}

/* =========================================================
   WELCOME NOTIFICATION
========================================================= */
export async function sendWelcomeNotification(userEmail, userName) {
  console.log(`[OneSignal] → sendWelcomeNotification(${userEmail})`);
  return sendPushNotification({
    externalId: userEmail,
    title:      `Welcome to Clauzify, ${userName?.split(" ")[0] || "there"} 👋`,
    body:       "Africa's legal intelligence is ready for your first question.",
    targetUrl: "https://legal-ai-companion-rag-fr.onrender.com",
    data:       { type: "welcome" },
  });
}

/* =========================================================
   TOKEN EXPIRY WARNING NOTIFICATION
========================================================= */
export async function sendTokenExpiryWarningPush(userEmail, tokens, daysLeft) {
  console.log(`[OneSignal] → sendTokenExpiryWarningPush(${userEmail}, tokens=${tokens}, daysLeft=${daysLeft})`);
  return sendPushNotification({
    externalId: userEmail,
    title:      `⏳ ${tokens} tokens expiring in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
    body:       "Use your tokens before they expire — ask a legal question or review a contract now.",
    targetUrl: "https://legal-ai-companion-rag-fr.onrender.com",
    data:       { type: "token_expiry_warning", tokens, daysLeft },
  });
}