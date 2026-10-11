import { NextResponse } from "next/server";
import { checkFile, MAX_FILE_BYTES } from "@/lib/creators/content-files";
import { submitContent } from "@/lib/creators/outreach";
import { isToken } from "@/lib/creators/outreach-flow";
import { portalViewOf } from "@/lib/creators/portal-extras";

export const dynamic = "force-dynamic";

const reply = (error: string, status: number) =>
  NextResponse.json({ ok: false, error }, { status });

/** A creator uploads their content from their own page. The page is the only way in; the token is the credential. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isToken(token)) return reply("We couldn't find that page.", 404);
  // Refuse before reading a body that can't be accepted.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES + 1024 * 1024)
    return reply("That file is too large. The limit is 25.0 MB.", 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply("We couldn't read that upload. Try again.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return reply("Choose a file to upload.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = checkFile(file.name, bytes);
  if (!checked.ok) return reply(checked.reason, 422);
  const result = await submitContent(token, "", String(form.get("caption") ?? ""), {
    name: checked.name,
    mime: checked.kind.mime,
    bytes,
  });
  if (!result.ok) return reply(result.error, 409);
  const view = await portalViewOf(token);
  return view ? NextResponse.json({ ok: true, view }) : reply("We couldn't find that page.", 404);
}
