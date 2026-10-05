import { createTransport } from "nodemailer";
import { db, emails } from "@/db/client";

export type EmailType =
  | "verify_email"
  | "invite"
  | "welcome"
  | "digest"
  | "alert"
  | "report"
  | "receipt"
  | "dunning"
  | "trial"
  | "billing"
  | "sales"
  | "support"
  | "security";

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * All outbound mail goes through here: stored in `emails` (read per user at /inbox) and, when
 * SMTP_URL is set, also delivered to Mailpit. Delivery failures never fail the request.
 */
export async function sendEmail(o: {
  /** Pre-chosen id, so the body can carry tracked links that point back at this message. */
  id?: string;
  toUserId?: string | null;
  to: string;
  type: EmailType;
  subject: string;
  text: string;
}): Promise<string> {
  const [row] = await db
    .insert(emails)
    .values({
      ...(o.id ? { id: o.id } : {}),
      toUserId: o.toUserId ?? null,
      toAddress: o.to,
      type: o.type,
      subject: o.subject,
      bodyText: o.text,
    })
    .returning({ id: emails.id });
  if (process.env.SMTP_URL) {
    try {
      await createTransport(process.env.SMTP_URL).sendMail({
        from: "Ripplewise <hello@ripplewise.test>",
        to: o.to,
        subject: o.subject,
        text: o.text,
      });
    } catch (err) {
      console.error("[email] SMTP delivery failed", err);
    }
  }
  return row!.id;
}

export function verifyEmail(token: string) {
  const link = `${APP_URL}/verify?token=${token}`;
  return {
    subject: "Verify your email to start listening",
    text: `Welcome to Ripplewise!\n\nConfirm your email to start collecting mentions:\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
  };
}

export function inviteEmail(o: {
  inviter: string;
  workspace: string;
  token: string;
  role?: string;
}) {
  const link = `${APP_URL}/invite/${o.token}`;
  const as =
    o.role === "client_viewer"
      ? " as a client (you'll see dashboards and reports)"
      : o.role
        ? ` as ${/^[aeiou]/i.test(o.role) ? "an" : "a"} ${o.role}`
        : "";
  return {
    subject: `${o.inviter} invited you to ${o.workspace} on Ripplewise`,
    text: `${o.inviter} invited you to join the "${o.workspace}" workspace${as}.\n\nAccept the invitation (sign in, or create your account, from this link):\n${link}\n\nThis invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
  };
}
