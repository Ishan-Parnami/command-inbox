"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHotkeys } from "react-hotkeys-hook";
import DOMPurify from "dompurify";
import { format } from "date-fns";
import { toast } from "sonner";
import { Star, Inbox as InboxIcon, Archive, Mail, MailOpen, Clock, Trash2, Keyboard, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CommandPalette, type PaletteGroup } from "@/components/shared/CommandPalette";
import { KeyboardShortcutModal } from "@/components/shared/KeyboardShortcutModal";

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

const SNOOZE_PRESETS: { label: string; ms: number }[] = [
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "30 minutes", ms: 30 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "2 hours", ms: 120 * 60_000 },
  { label: "6 hours", ms: 360 * 60_000 },
];

// Text-only "Undo" (no border / no background, highlighted text).
const UNDO_TOAST = {
  duration: 15_000,
  classNames: {
    actionButton:
      "!bg-transparent !border-0 !shadow-none !px-1 !text-primary font-medium hover:!underline",
  },
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

// Module-level so the current-time read stays out of the component render path.
function snoozeUntilIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function MessageBody({ message }: { message: Message }) {
  // Emails carry styling meant for a light background, so render them on a white
  // sheet in both themes — otherwise dark-on-dark text becomes invisible.
  if (message.bodyHtml && typeof window !== "undefined") {
    const clean = DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } });
    return (
      <div
        className="overflow-x-auto rounded-md bg-white p-4 text-sm leading-relaxed text-neutral-900 [&_a]:text-blue-600 [&_a]:underline"
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Threads with a pending (undoable) archive/trash — hidden until committed.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data: allThreads = initialThreads } = useQuery({
    queryKey: ["threads"],
    initialData: initialThreads,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/threads");
      if (!res.ok) throw new Error("Failed to load threads");
      return ((await res.json()) as { threads: ThreadListItem[] }).threads;
    },
  });

  const threads = useMemo(
    () => allThreads.filter((t) => !hiddenIds.has(t.id)),
    [allThreads, hiddenIds]
  );

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: threads.length, urgent: 0, high: 0, action: 0 };
    for (const t of threads) {
      if (t.priority === "urgent") c.urgent++;
      if (t.priority === "high") c.high++;
      if (t.tags?.includes("action-required")) c.action++;
    }
    return c;
  }, [threads]);

  const visible = useMemo(() => threads.filter((t) => matchesTab(t, tab)), [threads, tab]);

  const hideThread = (id: string) => setHiddenIds((s) => new Set(s).add(id));
  const unhideThread = (id: string) =>
    setHiddenIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  const action = useMutation({
    mutationFn: async (v: { action: string; threadId: string; snoozedUntil?: string }) => {
      const res = await fetch(`/api/actions/${v.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.signInLink) window.location.href = d.signInLink;
        throw new Error(d.error ?? "failed");
      }
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ["threads"] });
      const prev = queryClient.getQueryData<ThreadListItem[]>(["threads"]);
      queryClient.setQueryData<ThreadListItem[]>(["threads"], (old = []) => {
        if (v.action === "snooze") return old.filter((t) => t.id !== v.threadId);
        return old.map((t) =>
          t.id !== v.threadId
            ? t
            : {
                ...t,
                isStarred: v.action === "star" ? true : v.action === "unstar" ? false : t.isStarred,
                isRead: v.action === "read" ? true : v.action === "unread" ? false : t.isRead,
              }
        );
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["threads"], ctx.prev);
      toast.error("Action failed");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });

  const stateRef = useRef({ visible, selectedId });
  useEffect(() => {
    stateRef.current = { visible, selectedId };
  });

  const current = () =>
    stateRef.current.visible.find((t) => t.id === stateRef.current.selectedId) ?? null;

  const selectNextAfter = (id: string) => {
    const v = stateRef.current.visible;
    const idx = v.findIndex((x) => x.id === id);
    setSelectedId(v[idx + 1]?.id ?? v[idx - 1]?.id ?? null);
  };

  const move = (delta: number) => {
    const v = stateRef.current.visible;
    if (!v.length) return;
    const idx = Math.max(0, v.findIndex((t) => t.id === stateRef.current.selectedId));
    setSelectedId(v[Math.min(v.length - 1, Math.max(0, idx + delta))].id);
  };

  // Archive / trash with a 15s undo window — the Gmail call fires only if not undone.
  const undoableAct = (act: "archive" | "trash") => {
    const t = current();
    if (!t) return;
    selectNextAfter(t.id);
    hideThread(t.id);
    let undone = false;
    const timer = setTimeout(async () => {
      if (undone) return;
      try {
        const res = await fetch(`/api/actions/${act}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: t.id }),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Action failed");
      } finally {
        unhideThread(t.id);
        queryClient.invalidateQueries({ queryKey: ["threads"] });
      }
    }, 15_000);
    toast(act === "archive" ? "Archived" : "Moved to trash", {
      ...UNDO_TOAST,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          clearTimeout(timer);
          unhideThread(t.id);
          setSelectedId(t.id);
        },
      },
    });
  };

  const toggleStar = () => {
    const t = current();
    if (t) action.mutate({ action: t.isStarred ? "unstar" : "star", threadId: t.id });
  };
  const toggleRead = () => {
    const t = current();
    if (t) action.mutate({ action: t.isRead ? "unread" : "read", threadId: t.id });
  };
  const openSnooze = () => {
    if (current()) setSnoozeOpen(true);
  };
  const doSnooze = (ms: number) => {
    const t = current();
    setSnoozeOpen(false);
    if (!t) return;
    selectNextAfter(t.id);
    action.mutate({
      action: "snooze",
      threadId: t.id,
      snoozedUntil: snoozeUntilIso(ms),
    });
  };

  useHotkeys("j", () => move(1));
  useHotkeys("k", () => move(-1));
  useHotkeys("e", () => undoableAct("archive"));
  useHotkeys("s", toggleStar);
  useHotkeys("u", toggleRead);
  useHotkeys("h", openSnooze);
  useHotkeys("shift+3", () => undoableAct("trash"));
  useHotkeys("mod+k", (e) => { e.preventDefault(); setPaletteOpen((o) => !o); }, { enableOnFormTags: true });
  useHotkeys("shift+/", () => setShortcutsOpen(true));

  const selectedRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Opening an unread thread marks it read (Gmail + UI), like every mail client.
  const allThreadsRef = useRef(allThreads);
  useEffect(() => {
    allThreadsRef.current = allThreads;
  }, [allThreads]);
  useEffect(() => {
    if (!selectedId) return;
    const t = allThreadsRef.current.find((x) => x.id === selectedId);
    if (t && !t.isRead) action.mutate({ action: "read", threadId: selectedId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = threads.find((t) => t.id === selectedId) ?? null;

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

  const paletteGroups: PaletteGroup[] = [
    {
      heading: "Email",
      items: [
        { id: "archive", label: "Archive", icon: <Archive />, shortcut: "E", disabled: !selected, onSelect: () => undoableAct("archive") },
        { id: "star", label: selected?.isStarred ? "Unstar" : "Star", icon: <Star />, shortcut: "S", disabled: !selected, onSelect: toggleStar },
        { id: "read", label: selected?.isRead ? "Mark unread" : "Mark read", icon: selected?.isRead ? <MailOpen /> : <Mail />, shortcut: "U", disabled: !selected, onSelect: toggleRead },
        { id: "snooze", label: "Snooze…", icon: <Clock />, shortcut: "H", disabled: !selected, onSelect: openSnooze },
        { id: "trash", label: "Move to trash", icon: <Trash2 />, shortcut: "#", disabled: !selected, onSelect: () => undoableAct("trash") },
      ],
    },
    {
      heading: "Help",
      items: [
        { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, shortcut: "?", onSelect: () => setShortcutsOpen(true) },
      ],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />
      <KeyboardShortcutModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Thread list — collapsible, scrolls independently */}
      <div
        className={cn(
          "flex min-h-0 shrink-0 flex-col overflow-hidden border-r transition-[width] duration-200 ease-out",
          collapsed ? "w-14" : "w-96"
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          {!collapsed &&
            TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  tab === tb.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tb.label}
                {counts[tb.id] > 0 && <span className="ml-1 text-muted-foreground">{counts[tb.id]}</span>}
              </button>
            ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            !collapsed && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                <InboxIcon className="size-6" />
                <p className="text-sm">No emails yet. Hit “Sync” to pull your inbox.</p>
              </div>
            )
          ) : (
            visible.map((t) => {
              const sender = t.participantEmails?.[0] ?? "—";
              return collapsed ? (
                <button
                  key={t.id}
                  ref={selectedId === t.id ? selectedRowRef : null}
                  onClick={() => setSelectedId(t.id)}
                  title={sender}
                  className={cn(
                    "flex w-full items-center gap-2 border-b px-3 py-3 transition-colors hover:bg-muted/50",
                    selectedId === t.id && "bg-muted"
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", DOT[t.priority ?? "normal"] ?? "bg-transparent")} />
                  <span className={cn("truncate text-xs", t.isRead ? "text-muted-foreground" : "font-semibold text-foreground")}>
                    {sender.charAt(0).toUpperCase()}
                  </span>
                </button>
              ) : (
                <button
                  key={t.id}
                  ref={selectedId === t.id ? selectedRowRef : null}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    selectedId === t.id && "bg-muted"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[t.priority ?? "normal"] ?? "bg-transparent")} />
                      <span className={cn("truncate text-sm", t.isRead ? "font-normal text-foreground/80" : "font-semibold text-foreground")}>
                        {sender}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {t.isStarred && <Star className="size-3 fill-primary text-primary" />}
                      {shortDate(t.lastMessageAt)}
                    </span>
                  </div>
                  <span className={cn("truncate text-sm", t.isRead ? "text-muted-foreground" : "font-medium text-foreground")}>
                    {t.subject ?? "(no subject)"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{t.summary ?? t.snippet}</span>
                </button>
              );
            })
          )}
          {!collapsed && threads.length > 0 && visible.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing in {tab}.</p>
          )}
        </div>
      </div>

      {/* Reading pane — scrolls independently */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selected && (
          <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5">
            <Button variant="ghost" size="icon-sm" title="Archive (E)" onClick={() => undoableAct("archive")}>
              <Archive className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Star (S)" onClick={toggleStar}>
              <Star className={cn("size-4", selected.isStarred && "fill-primary text-primary")} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={selected.isRead ? "Mark unread (U)" : "Mark read (U)"}
              onClick={toggleRead}
            >
              {selected.isRead ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
            </Button>
            <DropdownMenu open={snoozeOpen} onOpenChange={setSnoozeOpen}>
              <DropdownMenuTrigger
                title="Snooze (H)"
                className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
              >
                <Clock className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {SNOOZE_PRESETS.map((p) => (
                  <DropdownMenuItem key={p.label} onClick={() => doSnooze(p.ms)}>
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon-sm" title="Trash (#)" onClick={() => undoableAct("trash")}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an email to read
            </div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
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
                      {m.fromName && <p className="truncate text-xs text-muted-foreground">{m.fromEmail}</p>}
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
    </div>
  );
}
