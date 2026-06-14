import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Command, Calendar } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { getInboxThreads } from "@/lib/inbox";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { UserMenu } from "@/components/shared/UserMenu";
import { SyncButton } from "@/components/inbox/SyncButton";
import { ConnectScreen } from "@/components/inbox/ConnectScreen";
import { InboxView } from "@/components/inbox/InboxView";
import { RealtimeListener } from "@/components/inbox/RealtimeListener";
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

  const threadItems = gmailConnected ? await getInboxThreads(userId) : [];

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {gmailConnected && <RealtimeListener />}

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
