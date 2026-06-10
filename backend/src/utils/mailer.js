import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
console.log("RESEND_API_KEY:", process.env.RESEND_API_KEY?.slice(0, 10));
console.log("EMAIL_FROM:", process.env.EMAIL_FROM);
export async function sendVerificationEmail(toEmail, token) {
  try {
    const { data, error } = await resend.emails.send({
      from: `CLAUZIFY <${process.env.EMAIL_FROM}>`,
      to: [toEmail],
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

    console.log("Email sent:", data);
    return data;
  } catch (err) {
    console.error("Failed to send email:", err);
    throw err;
  }
}