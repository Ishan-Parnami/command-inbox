import { Command } from "lucide-react";
import { auth } from "@/auth";
import { hasCorsairAccount } from "@/lib/corsair/client";
import { getInboxThreads } from "@/lib/inbox";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { UserMenu } from "@/components/shared/UserMenu";
import { SyncButton } from "@/components/inbox/SyncButton";
import { ConnectScreen } from "@/components/inbox/ConnectScreen";
import { InboxView } from "@/components/inbox/InboxView";
import { RealtimeListener } from "@/components/inbox/RealtimeListener";
import { LandingPage } from "@/components/landing/LandingPage";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope_error?: string; connect_error?: string }>;
}) {
  const { scope_error: scopeError, connect_error: connectError } = await searchParams;
  const session = await auth();
  if (!session?.user) return <LandingPage />;
  const userId = session.user.id;

  const [gmailConnected, calendarConnected] = await Promise.all([
    hasCorsairAccount(userId, "gmail"),
    hasCorsairAccount(userId, "googlecalendar"),
  ]);

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
          {gmailConnected && calendarConnected && <SyncButton />}
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      {scopeError && (
        <div className="flex items-center justify-between gap-3 border-b bg-destructive/10 px-4 py-2 text-sm">
          <span className="text-destructive">
            Please provide required access to connect{" "}
            {scopeError === "gmail" ? "Gmail" : "Google Calendar"}.
          </span>
          <a
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            href={`/api/corsair/connect?provider=${scopeError}`}
          >
            Try again
          </a>
        </div>
      )}

      {connectError && !scopeError && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Connection failed. Please try again.
        </div>
      )}

      {gmailConnected && calendarConnected ? (
        <InboxView initialThreads={threadItems} />
      ) : (
        <ConnectScreen gmailConnected={gmailConnected} calendarConnected={calendarConnected} />
      )}
    </div>
  );
}
