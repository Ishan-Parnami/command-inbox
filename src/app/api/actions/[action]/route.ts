import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailThreads, emails } from "@/lib/db/schema";
import {
  archiveMessage,
  markRead,
  markUnread,
  star,
  unstar,
  trashMessage,
  CorsairAuthError,
} from "@/lib/corsair/client";

// Gmail mutation per action (applied to every message in the thread).
const GMAIL_OP: Record<string, (userId: string, messageId: string) => Promise<unknown>> = {
  archive: archiveMessage,
  read: markRead,
  unread: markUnread,
  star,
  unstar,
  trash: trashMessage,
};

// Local mirror flags per action.
const DB_SET: Record<string, Partial<typeof emailThreads.$inferInsert>> = {
  archive: { isArchived: true },
  read: { isRead: true },
  unread: { isRead: false },
  star: { isStarred: true },
  unstar: { isStarred: false },
  trash: { isTrashed: true },
};

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { action } = await ctx.params;

  const { threadId, snoozedUntil } = (await req.json().catch(() => ({}))) as {
    threadId?: string;
    snoozedUntil?: string;
  };
  if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

  const [thread] = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.userId, userId)));
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Snooze is app-managed (no Gmail label) — just flag it out of the inbox.
  if (action === "snooze") {
    await db
      .update(emailThreads)
      .set({
        isSnoozed: true,
        snoozedUntil: snoozedUntil ? new Date(snoozedUntil) : new Date(Date.now() + 3_600_000),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, threadId));
    return NextResponse.json({ ok: true });
  }

  const op = GMAIL_OP[action];
  const set = DB_SET[action];
  if (!op || !set) return NextResponse.json({ error: "unknown_action" }, { status: 400 });

  const msgs = await db
    .select({ gid: emails.gmailMessageId })
    .from(emails)
    .where(eq(emails.threadId, threadId));

  try {
    await Promise.all(msgs.map((m) => op(userId, m.gid)));
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    return NextResponse.json({ error: "gmail_failed" }, { status: 502 });
  }

  await db.update(emailThreads).set({ ...set, updatedAt: new Date() }).where(eq(emailThreads.id, threadId));
  return NextResponse.json({ ok: true });
}
