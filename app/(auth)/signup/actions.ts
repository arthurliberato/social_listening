"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { createAccountAndUser } from "@/lib/auth/signup";
import { readSimContext } from "@/lib/sim-context";

export interface SignupState {
  errors?: Partial<Record<"name" | "email" | "password" | "company" | "form", string>>;
  values?: Record<string, string>;
}

const Schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid work email"),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  company: z.string().trim().min(1, "Enter your company or team name").max(100),
});

const ATTRIBUTION_KEYS = [
  "ga_client_id",
  "ga_session_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "gclid",
  "referrer",
];

export async function signUp(_prev: SignupState, form: FormData): Promise<SignupState> {
  const raw = Object.fromEntries(
    ["name", "email", "password", "company"].map((k) => [k, String(form.get(k) ?? "")]),
  );
  const values = { name: raw.name!, email: raw.email!, company: raw.company! };
  const invite = String(form.get("invite") ?? "") || null;
  const parsed = Schema.safeParse(invite ? { ...raw, company: raw.company || "invited" } : raw);
  if (!parsed.success) {
    const errors: NonNullable<SignupState["errors"]> = {};
    for (const issue of parsed.error.issues)
      errors[issue.path[0] as keyof typeof errors] ??= issue.message;
    return { errors, values };
  }
  const attribution = Object.fromEntries(
    ATTRIBUTION_KEYS.map((k) => [k, String(form.get(k) ?? "")]).filter(([, v]) => v),
  );
  const result = await createAccountAndUser({
    ...parsed.data,
    inviteToken: invite,
    attribution,
    sim: await readSimContext(),
  });
  if (!result.ok) {
    const msg = {
      email_taken: "An account with this email already exists. Log in instead.",
      invite_invalid: "This invitation link is invalid or has expired.",
      invite_email_mismatch: "Use the email address the invitation was sent to.",
    }[result.error];
    return {
      errors: {
        [result.error === "email_taken" || result.error === "invite_email_mismatch"
          ? "email"
          : "form"]: msg,
      },
      values,
    };
  }
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return {
        errors: { form: "Your account was created but we couldn't sign you in. Please log in." },
        values,
      };
    throw e;
  }
  // Someone who joined by invitation goes straight into the workspace they were invited to, not the product hub.
  redirect(invite ? "/?to=workspace" : "/verify");
}
