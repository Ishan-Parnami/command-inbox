"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CalendarEvent = {
  id: string;
  title: string | null;
  startTime: string | null;
  aiBrief?: string | null;
};

export function PreMeetingBrief({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const [brief, setBrief] = useState<string | null>(event.aiBrief ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brief/${event.id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.brief) {
        setBrief(data.brief);
      } else {
        setError("Couldn't generate a full brief — showing what we have.");
        if (data.brief) setBrief(data.brief);
      }
    } catch {
      setError("Brief generation is unavailable right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          Pre-meeting Brief
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{event.title}</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Generating brief…
        </div>
      ) : brief ? (
        <div className="space-y-1">
          {error && <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>}
          {brief.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className={cn("text-sm leading-snug", line.startsWith("•") ? "pl-1" : "")}>
              {line}
            </p>
          ))}
        </div>
      ) : error ? (
        <div className="space-y-2 text-center">
          <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>
          <Button size="sm" variant="outline" onClick={generate}>
            <Sparkles className="mr-1.5 size-3" />
            Try again
          </Button>
        </div>
      ) : (
        <div className="text-center">
          <p className="mb-2 text-xs text-muted-foreground">AI summary of attendees and relevant emails.</p>
          <Button size="sm" variant="outline" onClick={generate}>
            <Sparkles className="mr-1.5 size-3" />
            Generate Brief
          </Button>
        </div>
      )}

      {brief && !loading && (
        <Button size="sm" variant="ghost" className="self-start text-xs" onClick={generate}>
          <Sparkles className="mr-1 size-3" />
          Regenerate
        </Button>
      )}
    </div>
  );
}
