import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,   // false for port 587 (STARTTLS)
  family: 4,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendVerificationEmail(toEmail, token) {
  await transporter.sendMail({
    from: `"CLAUZIFY VERIFICATION" <${process.env.EMAIL_USER}>`,
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
