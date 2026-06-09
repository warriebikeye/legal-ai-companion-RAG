import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: process.env.EMAIL_USER,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
});

export async function sendVerificationEmail(toEmail, token) {
  await transporter.sendMail({
    from: `"CLAUZIFY" <${process.env.EMAIL_USER}>`,
    to: toEmail,
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
}
