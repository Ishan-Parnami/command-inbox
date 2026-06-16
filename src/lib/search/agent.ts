import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";
import { searchCachedMessages } from "@/lib/corsair/client";

type ThreadFilters = {
  isRead?: boolean;
  isStarred?: boolean;
  inInbox?: boolean;
};

async function searchLocalThreads(userId: string, filters: ThreadFilters, limit: number) {
  const conditions = [eq(emailThreads.userId, userId), eq(emailThreads.isTrashed, false)];

  if (filters.isRead !== undefined) conditions.push(eq(emailThreads.isRead, filters.isRead));
  if (filters.isStarred) conditions.push(eq(emailThreads.isStarred, true));
  if (filters.inInbox) conditions.push(eq(emailThreads.isArchived, false));

  const threads = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      participantEmails: emailThreads.participantEmails,
      lastMessageAt: emailThreads.lastMessageAt,
      isRead: emailThreads.isRead,
      isStarred: emailThreads.isStarred,
    })
    .from(emailThreads)
    .where(and(...conditions))
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(limit);

  return threads.map((t) => ({
    threadId: t.gmailThreadId,
    subject: t.subject,
    snippet: t.snippet,
    from: t.participantEmails?.[0] ?? null,
    participants: t.participantEmails,
    lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
    isRead: t.isRead,
    isStarred: t.isStarred,
    source: "local",
  }));
}

/**
 * Agent email search: Gmail operators (is:unread, etc.) hit our mirrored inbox;
 * everything else falls back to Corsair-cached text search.
 */
export async function searchEmailsForAgent(userId: string, query: string, limit = 10) {
  const raw = query.trim();
  if (!raw) return [];

  if (/\bis:unread\b/i.test(raw)) return searchLocalThreads(userId, { isRead: false, inInbox: true }, limit);
  if (/\bis:read\b/i.test(raw)) return searchLocalThreads(userId, { isRead: true }, limit);
  if (/\bis:starred\b/i.test(raw)) return searchLocalThreads(userId, { isStarred: true }, limit);
  if (/\bin:inbox\b/i.test(raw)) return searchLocalThreads(userId, { inInbox: true }, limit);

  return searchCachedMessages(userId, raw, limit);
}
