import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireUser, userWorkspaces } from "@/lib/auth/session";

/** Route signed-in users to wherever they left off; everyone else to sign-up. */
export default async function Index({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  if (!(await auth())?.user?.id) redirect("/signup");
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  if ((await searchParams).to === "workspace") {
    const first = (await userWorkspaces(user.id))[0];
    if (first) redirect(`/w/${first.slug}/home`);
  }
  redirect("/hub");
}
