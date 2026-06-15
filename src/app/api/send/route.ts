import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailThreads, emailDrafts } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { CorsairAuthError } from "@/lib/corsair/client";

type Body = {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  threadId?: string; // internal uuid of the thread we're replying into
  scheduledAt?: string; // ISO — when set, queue as a scheduled draft instead of sending
  draftId?: string; // draft to discard once sent
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Resolve the Gmail thread id so replies thread correctly in Gmail.
async function gmailThreadId(userId: string, threadId?: string) {
  if (!threadId) return undefined;
  const [t] = await db
    .select({ gid: emailThreads.gmailThreadId })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)));
  return t?.gid;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { to = [], cc = [], subject = "", body = "", threadId, scheduledAt, draftId } =
    (await req.json().catch(() => ({}))) as Body;

  if (to.length === 0 && !threadId) {
    return NextResponse.json({ error: "recipient required" }, { status: 400 });
  }

  const invalid = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) {
    return NextResponse.json({ error: `invalid recipient: ${invalid.join(", ")}` }, { status: 400 });
  }

  // Send Later: persist a scheduled draft (internal threadId; resolved at send).
  if (scheduledAt) {
    await db.insert(emailDrafts).values({
      userId,
      threadId: threadId ?? null,
      toEmails: to,
      ccEmails: cc,
      subject,
      body,
      isScheduled: true,
      scheduledAt: new Date(scheduledAt),
    });
    if (draftId) {
      await db.delete(emailDrafts).where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)));
    }
    return NextResponse.json({ scheduled: true });
  }

  try {
    await sendEmail(userId, { to, cc, subject, body, gmailThreadId: await gmailThreadId(userId, threadId) });
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  if (draftId) {
    await db.delete(emailDrafts).where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)));
  }
  return NextResponse.json({ ok: true });
}
