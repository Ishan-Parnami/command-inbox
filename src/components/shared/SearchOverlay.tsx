"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Search, X, Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AiCooldownBanner } from "@/components/shared/AiCooldownBanner";

type Hit = {
  gmailMessageId: string;
  cacheMessageId: string | null;
  cacheRow: Record<string, unknown> | null;
  threadId: string | null;
  gmailThreadId: string | null;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
  receivedAt: string | null;
  source: "vector" | "fts" | "corsair";
};

const SOURCE_LABEL: Record<Hit["source"], string> = {
  vector: "AI",
  fts: "Text",
  corsair: "Live",
};

function hitSender(h: Hit): string {
  return h.fromName ?? h.fromEmail ?? "";
}

function hitTitle(h: Hit): string {
  const subject = h.subject?.trim();
  if (subject) return subject;
  const preview = h.snippet?.trim();
  if (preview) return preview;
  const sender = hitSender(h);
  if (sender) return `Message from ${sender}`;
  return "Message";
}

function hitPreview(h: Hit): string | null {
  const subject = h.subject?.trim();
  const snippet = h.snippet?.trim();
  if (!snippet || !subject) return null;
  if (snippet === subject) return null;
  return snippet;
}

function hitResolveKey(h: Hit): string {
  return h.cacheMessageId ?? h.gmailMessageId;
}

export function SearchOverlay({
  open,
  onOpenChange,
  onSelectThread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectThread?: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setTimeout(() => { setQuery(""); setHits([]); setFocused(0); inputRef.current?.focus(); }, 50); }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setTimeout(() => { setHits([]); }, 50); return; }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) setHits((await res.json()).hits ?? []);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const select = async (h: Hit) => {
    let threadId = h.threadId;
    if (!threadId) {
      setResolvingId(hitResolveKey(h));
      try {
        const res = await fetch("/api/search/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gmailMessageId: h.gmailMessageId,
            cacheMessageId: h.cacheMessageId,
            gmailThreadId: h.gmailThreadId,
            cacheRow: h.cacheRow,
          }),
        });
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          toast.error("Reconnect Gmail to open this message.");
          if (body.signInLink) window.location.href = body.signInLink;
          return;
        }
        if (!res.ok) {
          toast.error("Couldn't open this message — try again.");
          return;
        }
        const body = (await res.json()) as { threadId?: string };
        threadId = body.threadId ?? null;
      } catch {
        toast.error("Couldn't open this message — try again.");
        return;
      } finally {
        setResolvingId(null);
      }
    }
    if (!threadId) {
      toast.error("Couldn't open this message — try again.");
      return;
    }
    onSelectThread?.(threadId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="top-1/4 translate-y-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Search emails</DialogTitle>
          <DialogDescription>Search across your inbox using AI, full-text, and live Gmail</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setFocused((f) => Math.min(f + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setFocused((f) => Math.max(f - 1, 0)); }
              if (e.key === "Enter" && hits[focused]) void select(hits[focused]);
              if (e.key === "Escape") onOpenChange(false);
            }}
            placeholder="Search emails…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => { setQuery(""); setHits([]); }}>
              <X className="size-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        <div className="px-3 pt-2">
          <AiCooldownBanner feature="search" />
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
          {!loading && query && hits.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No results for &quot;{query}&quot;</div>
          )}
          {hits.map((h, i) => {
            const title = hitTitle(h);
            const preview = hitPreview(h);
            const sender = hitSender(h);
            const isResolving = resolvingId === hitResolveKey(h);

            return (
              <button
                key={hitResolveKey(h)}
                onClick={() => void select(h)}
                disabled={!!resolvingId}
                className={cn(
                  "flex w-full items-start gap-3 border-b px-4 py-2.5 text-left transition-colors last:border-0",
                  i === focused ? "bg-muted" : "hover:bg-muted/50",
                  isResolving && "opacity-60"
                )}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {isResolving ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{isResolving ? "Opening…" : title}</span>
                    <span className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide",
                      h.source === "vector" ? "bg-primary/10 text-primary" :
                      h.source === "fts" ? "bg-muted text-muted-foreground" :
                      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    )}>
                      {SOURCE_LABEL[h.source]}
                    </span>
                  </span>
                  {(sender || h.receivedAt) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {sender}
                      {sender && h.receivedAt ? " · " : ""}
                      {h.receivedAt ? format(new Date(h.receivedAt), "MMM d, h:mm a") : ""}
                    </span>
                  )}
                  {preview && (
                    <span className="line-clamp-2 text-xs text-muted-foreground/90">{preview}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {!loading && !query && (
          <div className="px-4 py-4 text-xs text-muted-foreground space-y-1.5">
            <p>
              <span className="font-medium text-foreground">What is this?</span>{" "}
              A unified search across your inbox — use natural language or keywords to find threads fast.
            </p>
            <p>
              <span className="text-primary font-medium">AI</span> — semantic meaning (e.g. &quot;invoice from Acme&quot;) ·{" "}
              <span className="font-medium">Text</span> — subject/body keyword match ·{" "}
              <span className="font-medium text-green-700 dark:text-green-400">Live</span> — cached Gmail hits; opens on demand.
            </p>
            <p className="text-muted-foreground/80">Shortcut: ⌘F</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
