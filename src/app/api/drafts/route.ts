import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailDrafts } from "@/lib/db/schema";

type SaveBody = {
  draftId?: string;
  threadId?: string; // internal uuid (resolved to Gmail thread id only at send)
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
};

// List the user's drafts and queued "Send Later" messages (newest first).
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(emailDrafts)
    .where(eq(emailDrafts.userId, session.user.id))
    .orderBy(desc(emailDrafts.updatedAt));
  return NextResponse.json({
    drafts: rows.filter((d) => !d.isScheduled),
    scheduled: rows.filter((d) => d.isScheduled),
  });
}

// Autosave: insert on first save, update thereafter. Returns the draft id.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { draftId, threadId, to = [], cc = [], subject = "", body = "" } =
    (await req.json().catch(() => ({}))) as SaveBody;

  if (draftId) {
    await db
      .update(emailDrafts)
      .set({ toEmails: to, ccEmails: cc, subject, body, updatedAt: new Date() })
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)));
    return NextResponse.json({ id: draftId });
  }

  const [row] = await db
    .insert(emailDrafts)
    .values({ userId, threadId: threadId ?? null, toEmails: to, ccEmails: cc, subject, body })
    .returning({ id: emailDrafts.id });
  return NextResponse.json({ id: row.id });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { draftId } = (await req.json().catch(() => ({}))) as { draftId?: string };
  if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
  await db
    .delete(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, session.user.id)));
  return NextResponse.json({ ok: true });
}
