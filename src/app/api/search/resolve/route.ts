import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emails, emailThreads } from "@/lib/db/schema";
import { resolveSearchMessage } from "@/lib/sync/gmail";
import { CorsairAuthError } from "@/lib/corsair/client";

function hasMirroredContent(row: {
  subject?: string | null;
  bodyText?: string | null;
  bodySnippet?: string | null;
  snippet?: string | null;
}): boolean {
  return !!(
    row.subject?.trim() ||
    row.bodyText?.trim() ||
    row.bodySnippet?.trim() ||
    row.snippet?.trim()
  );
}

/** Fetch + mirror a Gmail message so search can open its thread in the inbox. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = (await req.json().catch(() => ({}))) as {
    gmailMessageId?: string;
    cacheMessageId?: string;
    gmailThreadId?: string;
    cacheRow?: Record<string, unknown>;
  };
  const { gmailMessageId, cacheMessageId, gmailThreadId, cacheRow } = body;
  if (!gmailMessageId?.trim() && !cacheMessageId?.trim() && !gmailThreadId?.trim() && !cacheRow) {
    return NextResponse.json({ error: "gmailMessageId required" }, { status: 400 });
  }

  if (gmailThreadId?.trim()) {
    const [thread] = await db
      .select({
        id: emailThreads.id,
        subject: emailThreads.subject,
        snippet: emailThreads.snippet,
      })
      .from(emailThreads)
      .where(and(eq(emailThreads.userId, userId), eq(emailThreads.gmailThreadId, gmailThreadId)));
    if (thread && hasMirroredContent(thread)) {
      return NextResponse.json({ threadId: thread.id });
    }
  }

  const lookupIds = [gmailMessageId, cacheMessageId].filter((id): id is string => !!id?.trim());
  if (lookupIds.length) {
    const [existing] = await db
      .select({
        threadId: emails.threadId,
        subject: emails.subject,
        bodyText: emails.bodyText,
        bodySnippet: emails.bodySnippet,
      })
      .from(emails)
      .where(and(eq(emails.userId, userId), or(...lookupIds.map((id) => eq(emails.gmailMessageId, id)))));
    if (existing?.threadId && hasMirroredContent(existing)) {
      return NextResponse.json({ threadId: existing.threadId });
    }
  }

  try {
    const { threadId } = await resolveSearchMessage(userId, {
      gmailMessageId,
      cacheMessageId,
      gmailThreadId,
      cacheRow,
    });
    return NextResponse.json({ threadId });
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    console.error("[search/resolve] failed:", e);
    return NextResponse.json({ error: "resolve_failed" }, { status: 502 });
  }
}
