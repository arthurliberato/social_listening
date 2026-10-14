import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { userWorkspaces } from "@/lib/auth/session";
import { SURVEY_ORDER, type SurveyId } from "@/lib/surveys/definitions";
import { dismissSurvey, submitSurvey, surveyForVisit } from "@/lib/surveys/service";

// A plain route rather than a server action on purpose: a server action makes Next refresh the page it was called from,
// and a survey check on every page load must not re-render the page under the person's hands.

const Id = z.enum(SURVEY_ORDER as unknown as [SurveyId, ...SurveyId[]]);
const Post = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    ws: z.string(),
    survey_id: Id,
    answers: z.record(z.string(), z.number()),
  }),
  z.object({ action: z.literal("dismiss"), ws: z.string(), survey_id: Id }),
]);

async function who(slug: string | null) {
  const session = await auth();
  if (!session?.user?.id || !slug) return null;
  const ws = (await userWorkspaces(session.user.id)).find((w) => w.slug === slug);
  // Client viewers see a branded read-only view; nobody asks them about the product.
  if (!ws || ws.role === "client_viewer") return null;
  return { userId: session.user.id, workspaceId: ws.id };
}

/** The survey to show on this visit, or `{ survey: null }`. */
export async function GET(req: Request) {
  const ctx = await who(new URL(req.url).searchParams.get("ws"));
  return NextResponse.json({ survey: ctx ? await surveyForVisit(ctx) : null });
}

export async function POST(req: Request) {
  const parsed = Post.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const ctx = await who(parsed.data.ws);
  if (!ctx) return NextResponse.json({ ok: false, error: "Not available." }, { status: 403 });
  if (parsed.data.action === "dismiss") {
    await dismissSurvey(ctx, parsed.data.survey_id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(await submitSurvey(ctx, parsed.data.survey_id, parsed.data.answers));
}
