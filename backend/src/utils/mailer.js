// src/utils/mailer.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/* =========================================================
   VERIFICATION EMAIL
========================================================= */
export async function sendVerificationEmail(toEmail, token) {
  try {
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
   Sent to both referrer and referee after verification
========================================================= */
export async function sendReferralRewardEmail(toEmail, toName, tokens, isReferrer) {
  try {
    const subject  = isReferrer
      ? `You earned ${tokens} tokens! Your referral joined Clauzify`
      : `Welcome bonus — ${tokens} tokens added to your wallet`;

    const headline = isReferrer
      ? `Your referral just verified their account`
      : `Your welcome bonus is ready`;

    const body = isReferrer
      ? `Someone you referred just joined Clauzify and verified their email. We've added <strong>${tokens} tokens</strong> to your wallet as a thank you.`
      : `You joined Clauzify via a referral link. We've added <strong>${tokens} tokens</strong> to your wallet as a welcome bonus — on top of your daily free queries.`;

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
          <p style="color:#999;font-size:12px">Tokens are valid for 90 days. Use them to ask legal questions or review contracts.</p>
          <a href="${process.env.CLIENT_URL_PROD || process.env.CLIENT_URL_TEST}"
             style="display:inline-block;margin-top:16px;padding:10px 24px;background:#c8a94a;color:#000;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px">
            Open Clauzify
          </a>
          <p style="color:#555;font-size:11px;margin-top:32px">Africa's Legal Intelligence Engine</p>
        </div>
      `,
    });

    if (error) {
      console.error("[mailer] Referral reward email error:", error);
      return null;
    }
    console.log(`[mailer] Referral reward email sent to ${toEmail}:`, data?.id);
    return data;
  } catch (err) {
    console.error("[mailer] Failed to send referral reward email:", err.message);
    return null; // Non-fatal
  }
}

/* =========================================================
   REFERRAL INVITE EMAIL
   Sent when a user shares their referral link
========================================================= */
export async function sendReferralInviteEmail(toEmail, referrerName, referralLink) {
  try {
    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to:   [toEmail],
      subject: `${referrerName || "Someone"} invited you to Clauzify`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px 24px;background:#0f0f0f;color:#f0f0f0;border-radius:12px">
          <h2 style="color:#c8a94a;margin:0 0 12px">You've been invited to Clauzify</h2>
          <p style="color:#ccc;line-height:1.6">
            <strong>${referrerName || "A friend"}</strong> thinks you'd find Clauzify useful —
            Africa's legal intelligence engine for reviewing contracts and getting instant legal answers.
          </p>
          <div style="margin:24px 0;padding:16px;background:rgba(200,169,74,0.1);border:1px solid rgba(200,169,74,0.3);border-radius:8px;text-align:center">
            <span style="font-size:22px;font-weight:700;color:#c8a94a">Get 75 free tokens</span>
            <p style="margin:4px 0 0;font-size:12px;color:#999">when you sign up via this link</p>
          </div>
          <a href="${referralLink}"
             style="display:inline-block;margin-top:8px;padding:12px 28px;background:#c8a94a;color:#000;border-radius:6px;font-weight:700;text-decoration:none;font-size:15px">
            Join Clauzify — Get 75 Tokens
          </a>
          <p style="color:#999;font-size:12px;margin-top:24px">
            Tokens can be used to review contracts, ask legal questions, and download PDF reports.
            Covers Nigeria, Ghana, Kenya, and South Africa.
          </p>
          <p style="color:#555;font-size:11px;margin-top:32px">Africa's Legal Intelligence Engine</p>
        </div>
      `,
    });

    if (error) {
      console.error("[mailer] Referral invite email error:", error);
      return null;
    }
    console.log(`[mailer] Referral invite sent to ${toEmail}:`, data?.id);
    return data;
  } catch (err) {
    console.error("[mailer] Failed to send referral invite:", err.message);
    return null;
  }
}