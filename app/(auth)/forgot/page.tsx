import Link from "next/link";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password · Ripplewise" };

export default function ForgotPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold leading-8">Reset your password</h1>
      <p className="text-[var(--text-muted)]">
        Enter your email and we&apos;ll send you a link to choose a new one.
      </p>
      <ForgotForm />
      <Link href="/login" className="text-sm underline">
        Back to log in
      </Link>
    </div>
  );
}
