"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BriefContent } from "@/components/calendar/BriefContent";
import { cn } from "@/lib/utils";

type CalendarEvent = {
  id: string;
  title: string | null;
  startTime: string | null;
  aiBrief?: string | null;
};

type BriefResponse = {
  brief?: string;
  previousBrief?: string | null;
  canRegenerate?: boolean;
  degraded?: boolean;
  message?: string;
};

export function PreMeetingBrief({
  event,
  onClose,
}: {
  event: CalendarEvent;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [brief, setBrief] = useState<string | null>(event.aiBrief ?? null);
  const [previousBrief, setPreviousBrief] = useState<string | null>(null);
  const [viewPrevious, setViewPrevious] = useState(false);
  const [canRegenerate, setCanRegenerate] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayedBrief = viewPrevious && previousBrief ? previousBrief : brief;
  const hasTwoVersions = !!brief && !!previousBrief;

  const applyBriefResponse = (data: BriefResponse) => {
    if (data.brief) setBrief(data.brief);
    if (data.previousBrief) setPreviousBrief(data.previousBrief);
    if (typeof data.canRegenerate === "boolean") setCanRegenerate(data.canRegenerate);
    if (data.message) setError(data.message);
    if (data.degraded) setError("Couldn't generate a full brief — showing what we have.");
  };

  // Load cached brief on open (events list may be stale after generation elsewhere).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/brief/${event.id}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json().catch(() => ({}))) as BriefResponse;
        applyBriefResponse(data);
      } catch {
        // keep prop seed or empty state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  const generate = async (regenerate = false) => {
    if (regenerate && !canRegenerate) return;
    setLoading(true);
    setError(null);
    try {
      const url = regenerate
        ? `/api/brief/${event.id}?regenerate=1`
        : `/api/brief/${event.id}`;
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as BriefResponse;
      if (res.status === 429) {
        setError("Daily brief limit reached — try again tomorrow.");
        return;
      }
      if (res.ok && data.brief) {
        if (regenerate && brief) {
          setViewPrevious(false);
        }
        applyBriefResponse(data);
        queryClient.invalidateQueries({ queryKey: ["events"] });
      } else if (data.brief) {
        applyBriefResponse(data);
      } else {
        setError("Couldn't generate a full brief — showing what we have.");
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
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>

      <p className="text-xs font-medium text-muted-foreground">{event.title}</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Generating brief…
        </div>
      ) : displayedBrief ? (
        <div className="space-y-1">
          {error && <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>}
          <BriefContent brief={displayedBrief} />
        </div>
      ) : error ? (
        <div className="space-y-2 text-center">
          <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>
          <Button size="sm" variant="outline" onClick={() => generate()}>
            <Sparkles className="mr-1.5 size-3" />
            Try again
          </Button>
        </div>
      ) : (
        <div className="text-center">
          <p className="mb-2 text-xs text-muted-foreground">AI summary of attendees and relevant emails.</p>
          <Button size="sm" variant="outline" onClick={() => generate()}>
            <Sparkles className="mr-1.5 size-3" />
            Generate Brief
          </Button>
        </div>
      )}

      {brief && !loading && canRegenerate && (
        <Button size="sm" variant="ghost" className="self-start text-xs" onClick={() => generate(true)}>
          <Sparkles className="mr-1 size-3" />
          Regenerate
        </Button>
      )}

      {hasTwoVersions && !loading && (
        <div className="flex items-center gap-1 self-start">
          <Button
            size="sm"
            variant="ghost"
            className={cn("text-xs", !viewPrevious && "bg-muted font-medium")}
            onClick={() => setViewPrevious(false)}
          >
            Latest
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn("text-xs", viewPrevious && "bg-muted font-medium")}
            onClick={() => setViewPrevious(true)}
          >
            Previous
          </Button>
        </div>
      )}
    </div>
  );
}
