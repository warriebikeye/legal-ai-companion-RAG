// src/utils/mailer.js
import { Resend } from "resend";

/* ── Get Resend client lazily — ensures dotenv is loaded first ── */
function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("[mailer] RESEND_API_KEY is not set in environment variables");
  }
  return new Resend(process.env.RESEND_API_KEY);
}

/* =========================================================
   VERIFICATION EMAIL
========================================================= */
export async function sendVerificationEmail(toEmail, token) {
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to:   [toEmail],
      subject: "Your verification code",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:auto">
          <h2>Verify your email</h2>
          <p>Enter this code in the app:</p>
          <h1 style="letter-spacing:8px;color:#5a4bff">${token}</h1>
          <p>Expires in 15 minutes.</p>
        </div>
      `,
    });
    if (error) {
      console.error("Resend error:", error);
      throw new Error(error.message);
    }
    console.log("Verification email sent:", data);
    return data;
  } catch (err) {
    console.error("Failed to send verification email:", err);
    throw err;
  }
}

/* =========================================================
   REFERRAL REWARD EMAIL
========================================================= */
export async function sendReferralRewardEmail(toEmail, firstname, tokens) {
  try {
    const resend   = getResend();
    const subject  = `You earned ${tokens} tokens! Your referral joined Clauzify`;
    const headline = `Your referral just verified their account`;
    const body     = `Someone you referred just joined Clauzify and verified their email. We've added <strong>${tokens} tokens</strong> to your wallet as a thank you.`;

    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to:   [toEmail],
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0f0f;color:#f0f0f0;border-radius:12px">
          <h2 style="color:#c8a94a;margin:0 0 12px">${headline}</h2>
          <p style="color:#ccc;line-height:1.6">${body}</p>
          <div style="margin:24px 0;padding:16px;background:rgba(200,169,74,0.1);border:1px solid rgba(200,169,74,0.3);border-radius:8px;text-align:center">
            <span style="font-size:28px;font-weight:700;color:#c8a94a">+${tokens} tokens</span>
            <p style="margin:4px 0 0;font-size:12px;color:#999">added to your Clauzify wallet</p>
          </div>
          <p style="color:#999;font-size:12px">Tokens are valid for 90 days.</p>
          <a href="${process.env.CLIENT_URL_PROD || process.env.CLIENT_URL_TEST}"
             style="display:inline-block;margin-top:16px;padding:10px 24px;background:#c8a94a;color:#000;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px">
            Open Clauzify
          </a>
          <p style="color:#555;font-size:11px;margin-top:32px">Africa's Legal Intelligence Engine</p>
        </div>
      `,
    });
    if (error) { console.error("[mailer] Referral reward error:", error); return null; }
    console.log(`[mailer] Referral reward sent to ${toEmail}:`, data?.id);
    return data;
  } catch (err) {
    console.error("[mailer] Failed to send referral reward:", err.message);
    return null;
  }
}

/* =========================================================
   REFERRAL INVITE EMAIL
========================================================= */
export async function sendReferralInviteEmail(toEmail, referrerFirstname, referralLink) {
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to:   [toEmail],
      subject: `${referrerFirstname || "Someone"} invited you to Clauzify`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0f0f;color:#f0f0f0;border-radius:12px">
          <h2 style="color:#c8a94a;margin:0 0 12px">You've been invited to Clauzify</h2>
          <p style="color:#ccc;line-height:1.6">
            <strong>${referrerFirstname || "A friend"}</strong> thinks you'd find Clauzify useful —
            Africa's legal intelligence engine for reviewing contracts and getting instant legal answers.
          </p>
          <a href="${referralLink}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#c8a94a;color:#000;border-radius:6px;font-weight:700;text-decoration:none;font-size:15px">
            Join Clauzify
          </a>
          <p style="color:#555;font-size:11px;margin-top:32px">Africa's Legal Intelligence Engine</p>
        </div>
      `,
    });
    if (error) { console.error("[mailer] Invite error:", error); return null; }
    console.log(`[mailer] Invite sent to ${toEmail}:`, data?.id);
    return data;
  } catch (err) {
    console.error("[mailer] Failed to send invite:", err.message);
    return null;
  }
}

/* =========================================================
   TOKEN EXPIRY WARNING EMAIL
========================================================= */
export async function sendTokenExpiryWarningEmail(toEmail, firstname, tokens, daysLeft) {
  try {
    const resend    = getResend();
    const firstName = firstname || "there";

    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to:   [toEmail],
      subject: `⏳ Your ${tokens} Clauzify tokens expire in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0f0f;color:#f0f0f0;border-radius:12px">
          <h2 style="color:#c8a94a;margin:0 0 12px">
            Hi ${firstName}, your tokens are expiring soon
          </h2>
          <p style="color:#ccc;line-height:1.6">
            You have <strong style="color:#c8a94a">${tokens} tokens</strong> expiring
            in <strong>${daysLeft} day${daysLeft > 1 ? "s" : ""}</strong>. Use them before they're gone.
          </p>
          <div style="margin:24px 0;padding:16px;background:rgba(200,169,74,0.1);border:1px solid rgba(200,169,74,0.3);border-radius:8px;text-align:center">
            <span style="font-size:28px;font-weight:700;color:#c8a94a">${tokens} tokens</span>
            <p style="margin:4px 0 0;font-size:12px;color:#f87171">
              ⚠️ Expire in ${daysLeft} day${daysLeft > 1 ? "s" : ""}
            </p>
          </div>
          <ul style="color:#ccc;font-size:14px;line-height:2;padding-left:20px;margin:8px 0 20px">
            <li>Ask up to ${Math.floor(tokens / 4)} legal questions</li>
            <li>Review ${Math.floor(tokens / 65)} contract${Math.floor(tokens / 65) !== 1 ? "s" : ""} + get PDF reports</li>
          </ul>
          <a href="${process.env.CLIENT_URL_PROD || process.env.CLIENT_URL_TEST}"
             style="display:inline-block;padding:12px 28px;background:#c8a94a;color:#000;border-radius:6px;font-weight:700;text-decoration:none;font-size:15px">
            Use My Tokens Now
          </a>
          <p style="color:#555;font-size:11px;margin-top:32px">
            Tokens expire 90 days after purchase.<br/>Africa's Legal Intelligence Engine
          </p>
        </div>
      `,
    });
    if (error) { console.error("[mailer] Expiry warning error:", error); return null; }
    console.log(`[mailer] Expiry warning sent to ${toEmail}:`, data?.id);
    return data;
  } catch (err) {
    console.error("[mailer] Failed to send expiry warning:", err.message);
    return null;
  }
}