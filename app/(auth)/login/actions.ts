"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { lockedUntil, minutesLeft } from "@/lib/auth/throttle";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function logIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const until = email ? await lockedUntil(email) : null;
  if (until)
    return {
      error: `Too many failed attempts. Try again in ${minutesLeft(until)} minute${minutesLeft(until) === 1 ? "" : "s"}, or reset your password to log in now.`,
      email,
    };
  try {
    await signIn("credentials", {
      email,
      password: String(form.get("password") ?? ""),
      redirectTo: String(form.get("next") || "/"),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return { error: "That email and password don't match. Check them and try again.", email };
    throw e; // the success redirect is thrown by signIn
  }
  return {};
}
