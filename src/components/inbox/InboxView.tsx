"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { format } from "date-fns";
import { Star, Inbox as InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThreadListItem = {
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

type Message = {
  id: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string | null;
};

type Tab = "all" | "urgent" | "high" | "action";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "action", label: "Action" },
];

const DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-muted-foreground/40",
  low: "bg-muted-foreground/30",
};

function matchesTab(t: ThreadListItem, tab: Tab) {
  if (tab === "all") return true;
  if (tab === "action") return t.tags?.includes("action-required") ?? false;
  return t.priority === tab;
}

function shortDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString() ? format(d, "h:mm a") : format(d, "MMM d");
}

function MessageBody({ message }: { message: Message }) {
  if (message.bodyHtml && typeof window !== "undefined") {
    const clean = DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } });
    return (
      <div
        className="max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return (
    <p className="text-sm whitespace-pre-wrap text-foreground/90">
      {message.bodyText ?? "(no content)"}
    </p>
  );
}

export function InboxView({ initialThreads }: { initialThreads: ThreadListItem[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialThreads[0]?.id ?? null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: initialThreads.length, urgent: 0, high: 0, action: 0 };
    for (const t of initialThreads) {
      if (t.priority === "urgent") c.urgent++;
      if (t.priority === "high") c.high++;
      if (t.tags?.includes("action-required")) c.action++;
    }
    return c;
  }, [initialThreads]);

  const visible = useMemo(
    () => initialThreads.filter((t) => matchesTab(t, tab)),
    [initialThreads, tab]
  );

  const { data, isLoading } = useQuery({
    queryKey: ["thread", selectedId],
    enabled: !!selectedId,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`/api/threads/${selectedId}`);
      if (!res.ok) throw new Error("Failed to load thread");
      return (await res.json()) as { messages: Message[] };
    },
  });

  if (initialThreads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <InboxIcon className="size-6" />
        <p className="text-sm">No emails yet. Hit “Sync” to pull your inbox.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Thread list */}
      <div className="flex w-full max-w-sm shrink-0 flex-col border-r">
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                tab === tb.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tb.label}
              {counts[tb.id] > 0 && (
                <span className="ml-1 text-muted-foreground">{counts[tb.id]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                selectedId === t.id && "bg-muted"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      DOT[t.priority ?? "normal"] ?? "bg-transparent"
                    )}
                  />
                  <span
                    className={cn(
                      "truncate text-sm",
                      t.isRead ? "font-normal text-foreground/80" : "font-semibold text-foreground"
                    )}
                  >
                    {t.participantEmails?.[0] ?? "—"}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {t.isStarred && <Star className="size-3 fill-primary text-primary" />}
                  {shortDate(t.lastMessageAt)}
                </span>
              </div>
              <span
                className={cn(
                  "truncate text-sm",
                  t.isRead ? "text-muted-foreground" : "font-medium text-foreground"
                )}
              >
                {t.subject ?? "(no subject)"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t.summary ?? t.snippet}
              </span>
            </button>
          ))}
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing in {tab}.
            </p>
          )}
        </div>
      </div>

      {/* Reading pane */}
      <div className="flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select an email to read
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
            <h1 className="text-lg font-semibold tracking-tight">
              {data?.messages[0]?.subject ?? "(no subject)"}
            </h1>
            {data?.messages.map((m) => (
              <div key={m.id} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.fromName ?? m.fromEmail}</p>
                    {m.fromName && (
                      <p className="truncate text-xs text-muted-foreground">{m.fromEmail}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.receivedAt ? format(new Date(m.receivedAt), "MMM d, h:mm a") : ""}
                  </span>
                </div>
                <MessageBody message={m} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
