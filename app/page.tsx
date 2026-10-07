import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth/session";

/** Route signed-in users to wherever they left off; everyone else to sign-up. */
export default async function Index() {
  if (!(await auth())?.user?.id) redirect("/signup");
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  redirect("/hub");
}
