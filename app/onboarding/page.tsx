import { redirect } from "next/navigation";
import { requireUser, userWorkspaces } from "@/lib/auth/session";
import { Wizard } from "./Wizard";

export const metadata = { title: "Set up · Ripplewise" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  if (user.onboardingCompletedAt) redirect(`/w/${(await userWorkspaces(user.id))[0]!.slug}/home`);
  const data = user.onboardingData as {
    brand?: { brandName?: string; website?: string; handles?: string[]; competitors?: string[] };
  };
  return (
    <Wizard
      initialStep={user.onboardingStep}
      initial={{ role: user.roleSelected, goals: user.goals, brand: data.brand ?? {} }}
    />
  );
}
