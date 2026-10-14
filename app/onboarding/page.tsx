import { redirect } from "next/navigation";
import { requireUser, userWorkspaces } from "@/lib/auth/session";
import { variantFor } from "@/lib/flags";
import { Wizard } from "./Wizard";

export const metadata = { title: "Set up · Ripplewise" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify");
  if (user.onboardingCompletedAt) redirect(`/w/${(await userWorkspaces(user.id))[0]!.slug}/home`);
  const data = user.onboardingData as {
    brand?: { brandName?: string; website?: string; handles?: string[]; competitors?: string[] };
  };
  // Assigned per account: a wizard that differs between two people in one account would make the arms unfair.
  const accountId = (await userWorkspaces(user.id))[0]!.accountId;
  return (
    <Wizard
      escapeHatch={variantFor("wizard_escape_hatch", accountId)}
      initialStep={user.onboardingStep}
      initial={{ role: user.roleSelected, goals: user.goals, brand: data.brand ?? {} }}
    />
  );
}
