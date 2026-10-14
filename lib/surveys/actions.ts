"use server";

import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { SURVEY_ORDER, type SurveyId } from "./definitions";
import { dismissSurvey, submitSurvey, surveyForVisit, type SurveyView } from "./service";

const Id = z.enum(SURVEY_ORDER as unknown as [SurveyId, ...SurveyId[]]);

async function who(slug: string) {
  const { user, ws } = await requireWorkspace(slug);
  // Client viewers see a branded read-only view; nobody asks them about the product.
  if (ws.realRole === "client_viewer") return null;
  return { userId: user.id, workspaceId: ws.id };
}

export async function getSurvey(slug: string): Promise<SurveyView | null> {
  const ctx = await who(slug);
  return ctx ? surveyForVisit(ctx) : null;
}

export async function answerSurvey(
  slug: string,
  surveyId: string,
  answers: Record<string, number>,
) {
  const ctx = await who(slug);
  const id = Id.safeParse(surveyId);
  if (!ctx || !id.success) return { ok: false as const, error: "This question is no longer open." };
  return submitSurvey(ctx, id.data, z.record(z.string(), z.number()).parse(answers));
}

export async function dismissSurveyAction(slug: string, surveyId: string) {
  const ctx = await who(slug);
  const id = Id.safeParse(surveyId);
  if (ctx && id.success) await dismissSurvey(ctx, id.data);
}
