import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Command, Calendar } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections, emailThreads, emails, llmClassifications } from "@/lib/db/schema";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { UserMenu } from "@/components/shared/UserMenu";
import { SyncButton } from "@/components/inbox/SyncButton";
import { ConnectScreen } from "@/components/inbox/ConnectScreen";
import { InboxView } from "@/components/inbox/InboxView";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope_error?: string; connect_error?: string }>;
}) {
  const { scope_error: scopeError } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const conns = await db
    .select()
    .from(corsairConnections)
    .where(eq(corsairConnections.userId, userId));
  const gmailConnected = conns.some((c) => c.provider === "gmail");
  const calendarConnected = conns.some((c) => c.provider === "googlecalendar");

  const threads = gmailConnected
    ? await db
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
        .orderBy(desc(emailThreads.lastMessageAt))
        .limit(50)
    : [];

  // Latest classified email per thread → the thread's priority/summary/tags.
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

  const threadItems = threads
    .map((t) => {
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
    })
    .sort((a, b) => {
      const ra = PRIORITY_RANK[a.priority ?? "normal"] ?? 2;
      const rb = PRIORITY_RANK[b.priority ?? "normal"] ?? 2;
      if (ra !== rb) return ra - rb;
      if ((b.priorityScore ?? 0) !== (a.priorityScore ?? 0))
        return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
    });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Command className="size-4 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Command Inbox</span>
        </div>
        <div className="flex items-center gap-1.5">
          {gmailConnected && <SyncButton />}
          {!calendarConnected && (
            <a
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/api/corsair/connect?provider=googlecalendar"
            >
              <Calendar className="size-4" />
              Connect Calendar
            </a>
          )}
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      {scopeError && (
        <div className="flex items-center justify-between gap-3 border-b bg-destructive/10 px-4 py-2 text-sm">
          <span className="text-destructive">
            {scopeError === "gmail" ? "Gmail" : "Calendar"} connected with limited permissions.
            Reading your data needs full access — please reconnect and allow all.
          </span>
          <a
            className={cn(buttonVariants({ size: "sm" }))}
            href={`/api/corsair/connect?provider=${scopeError}`}
          >
            Reconnect
          </a>
        </div>
      )}

      {gmailConnected ? (
        <InboxView initialThreads={threadItems} />
      ) : (
        <ConnectScreen gmailConnected={gmailConnected} calendarConnected={calendarConnected} />
      )}
    </div>
  );
}
