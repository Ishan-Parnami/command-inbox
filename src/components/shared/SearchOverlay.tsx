"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Hit = {
  gmailMessageId: string;
  threadId: string | null;
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

  const select = (h: Hit) => {
    if (h.threadId && onSelectThread) onSelectThread(h.threadId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-1/4 translate-y-0 overflow-hidden p-0 sm:max-w-xl">
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
              if (e.key === "Enter" && hits[focused]) select(hits[focused]);
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

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
          {!loading && query && hits.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No results for &quot;{query}&quot;</div>
          )}
          {hits.map((h, i) => (
            <button
              key={h.gmailMessageId}
              onClick={() => select(h)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b px-4 py-2.5 text-left transition-colors last:border-0",
                i === focused ? "bg-muted" : "hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{h.subject ?? "(no subject)"}</span>
                <span className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-xs font-mono",
                  h.source === "vector" ? "bg-primary/10 text-primary" :
                  h.source === "fts" ? "bg-muted text-muted-foreground" :
                  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                )}>
                  {SOURCE_LABEL[h.source]}
                </span>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {h.fromName ?? h.fromEmail ?? ""}
                {h.receivedAt ? ` · ${format(new Date(h.receivedAt), "MMM d")}` : ""}
              </span>
              {h.snippet && <span className="line-clamp-1 text-xs text-muted-foreground">{h.snippet}</span>}
            </button>
          ))}
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
              <span className="font-medium text-green-700 dark:text-green-400">Live</span> — hits Gmail directly if not cached yet.
            </p>
            <p className="text-muted-foreground/80">Shortcut: ⌘F or /</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
