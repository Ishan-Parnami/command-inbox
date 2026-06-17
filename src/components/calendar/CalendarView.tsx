"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CreateEventModal, type EventSeed } from "@/components/calendar/CreateEventModal";
import { cn } from "@/lib/utils";
import { TimeGrid } from "./TimeGrid";
import { MonthGrid } from "./MonthGrid";
import { EventDetailDrawer } from "./EventDetailDrawer";
import type { CalEvent, CalendarViewMode } from "./types";

const VIEWS: CalendarViewMode[] = ["day", "week", "month"];

function windowFor(view: CalendarViewMode, anchor: Date): { from: Date; to: Date } {
  if (view === "day") return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === "week") return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  return { from: startOfWeek(startOfMonth(anchor)), to: endOfWeek(endOfMonth(anchor)) };
}

function headerLabel(view: CalendarViewMode, anchor: Date): string {
  if (view === "day") return format(anchor, "EEEE, MMMM d, yyyy");
  if (view === "month") return format(anchor, "MMMM yyyy");
  const { from, to } = windowFor("week", anchor);
  const sameMonth = from.getMonth() === to.getMonth();
  return sameMonth
    ? `${format(from, "MMM d")} – ${format(to, "d, yyyy")}`
    : `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`;
}

export function CalendarView({ initialSeed }: { initialSeed?: EventSeed }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() =>
    initialSeed?.startTime ? new Date(initialSeed.startTime) : new Date()
  );

  const [createOpen, setCreateOpen] = useState(!!initialSeed?.startTime);
  const [seed, setSeed] = useState<EventSeed>(initialSeed ?? {});
  const [editId, setEditId] = useState<string | undefined>(undefined);

  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // One-time calendar sync, mirroring CalendarSidebar behavior.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    fetch("/api/calendar/sync", { method: "POST" })
      .then(async (r) => {
        if (r.ok) await queryClient.invalidateQueries({ queryKey: ["events"] });
      })
      .catch(() => {});
  }, [queryClient]);

  const { from, to } = useMemo(() => windowFor(view, anchor), [view, anchor]);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const { data } = useQuery({
    queryKey: ["events", fromISO, toISO],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`/api/events?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`);
      if (!res.ok) throw new Error("Failed to load events");
      return (await res.json()) as { events: CalEvent[] };
    },
  });
  const events = data?.events ?? [];

  const days = useMemo(() => {
    if (view === "day") return [startOfDay(anchor)];
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [view, anchor]);

  const step = (dir: 1 | -1) => {
    setAnchor((a) =>
      view === "day" ? addDays(a, dir) : view === "week" ? addWeeks(a, dir) : addMonths(a, dir)
    );
  };

  const openCreate = (s: EventSeed = {}) => {
    setEditId(undefined);
    setSeed(s);
    setCreateOpen(true);
  };

  const openReschedule = (ev: CalEvent) => {
    setSelected(null);
    setEditId(ev.id);
    setSeed({
      title: ev.title ?? "",
      description: ev.description ?? undefined,
      location: ev.location ?? undefined,
      startTime: ev.startTime ?? undefined,
      endTime: ev.endTime ?? undefined,
      attendees: ev.attendees.map((a) => a.email).join(", "),
    });
    setCreateOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const ev = deleteTarget;
    setDeleteTarget(null);
    setSelected(null);
    setDeletingId(ev.id);
    try {
      const res = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.signInLink) {
          window.location.href = body.signInLink;
          return;
        }
        throw new Error(body.error ?? "Delete failed");
      }
      toast.success("Event deleted");
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <div className="flex items-center">
          <Button size="icon-sm" variant="ghost" onClick={() => step(-1)} title="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => step(1)} title="Next">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <span className="text-sm font-semibold">{headerLabel(view, anchor)}</span>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="size-4" /> New event
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="relative min-h-0 flex-1">
        {view === "month" ? (
          <MonthGrid
            anchorDate={anchor}
            events={events}
            onSelectEvent={setSelected}
            onSelectDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        ) : (
          <TimeGrid
            days={days}
            events={events}
            onSelectEvent={setSelected}
            onSlotClick={(start) => openCreate({ startTime: start.toISOString() })}
          />
        )}
      </div>

      <EventDetailDrawer
        event={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onReschedule={openReschedule}
        onDelete={setDeleteTarget}
        deleting={!!selected && deletingId === selected.id}
      />

      <CreateEventModal
        key={editId ?? `new-${seed.startTime ?? ""}`}
        open={createOpen}
        seed={seed}
        eventId={editId}
        onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["events"] })}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete event?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title ?? "This event"}” will be removed from Google Calendar too. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
