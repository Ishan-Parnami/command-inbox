import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads, emails, llmClassifications } from "@/lib/db/schema";

export type InboxThread = {
  id: string;
  subject: string | null;
  snippet: string | null;
  participantEmails: string[] | null;
  isRead: boolean;
  isStarred: boolean;
  lastMessageAt: string | null;
  priority: string | null;
  priorityScore: number | null;
  summary: string | null;
  tags: string[] | null;
};

// Inbox thread list: active threads joined to their latest email's classification,
// ordered by priority tier → score → recency. Shared by the page (SSR seed) and
// the /api/threads route (client refetch on SSE events).
export async function getInboxThreads(userId: string): Promise<InboxThread[]> {
  const threads = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.isArchived, false),
        eq(emailThreads.isTrashed, false),
        eq(emailThreads.isSnoozed, false)
      )
    )
    .orderBy(sql`${emailThreads.lastMessageAt} desc nulls last`)
    .limit(50);

  const threadIds = threads.map((t) => t.id);
  const classRows = threadIds.length
    ? await db
        .select({
          threadId: emails.threadId,
          priority: llmClassifications.priority,
          priorityScore: llmClassifications.priorityScore,
          summary: llmClassifications.summary,
          tags: llmClassifications.tags,
        })
        .from(emails)
        .innerJoin(llmClassifications, eq(llmClassifications.emailId, emails.id))
        .where(inArray(emails.threadId, threadIds))
        .orderBy(desc(emails.receivedAt))
    : [];

  const classByThread = new Map<string, (typeof classRows)[number]>();
  for (const r of classRows) if (!classByThread.has(r.threadId)) classByThread.set(r.threadId, r);

  // Chronological (newest first); priority is surfaced via dots + tabs, not order.
  return threads.map((t) => {
    const c = classByThread.get(t.id);
    return {
      id: t.id,
      subject: t.subject,
      snippet: t.snippet,
      participantEmails: t.participantEmails,
      isRead: t.isRead,
      isStarred: t.isStarred,
      lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
      priority: c?.priority ?? null,
      priorityScore: c?.priorityScore ?? null,
      summary: c?.summary ?? null,
      tags: c?.tags ?? null,
    };
  });
}
