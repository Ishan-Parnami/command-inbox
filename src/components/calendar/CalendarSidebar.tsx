"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isTomorrow } from "date-fns";
import { Calendar, Plus, ExternalLink, Users, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CreateEventModal, type EventSeed } from "@/components/calendar/CreateEventModal";
import { PreMeetingBrief } from "@/components/calendar/PreMeetingBrief";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Attendee = { email: string; name: string | null; rsvpStatus: string; isOrganizer: boolean };

type CalEvent = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  meetingLink: string | null;
  location: string | null;
  description: string | null;
  status: string;
  aiBrief: string | null;
  attendees: Attendee[];
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE, MMM d");
}

function timeRange(ev: CalEvent) {
  if (ev.isAllDay) return "All day";
  const s = ev.startTime ? format(new Date(ev.startTime), "h:mm a") : "";
  const e = ev.endTime ? format(new Date(ev.endTime), "h:mm a") : "";
  return `${s} – ${e}`;
}

// Group events by calendar day.
function groupByDay(events: CalEvent[]) {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    if (!ev.startTime) continue;
    const key = format(new Date(ev.startTime), "yyyy-MM-dd");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }
  return map;
}

export function CalendarSidebar({ initialSeed, onClose }: { initialSeed?: EventSeed; onClose?: () => void; }) {
  const [createOpen, setCreateOpen] = useState(!!initialSeed?.startTime);
  const [seed, setSeed] = useState<EventSeed>(initialSeed ?? {});
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [briefEvent, setBriefEvent] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["events"],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/events");
      if (!res.ok) throw new Error("Failed to load events");
      return (await res.json()) as { events: CalEvent[] };
    },
  });

  const events = data?.events ?? [];
  const grouped = groupByDay(events);

  const openCreate = (s: EventSeed = {}) => {
    setEditId(undefined);
    setSeed(s);
    setCreateOpen(true);
  };

  const openReschedule = (ev: CalEvent) => {
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

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalEvent | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const ev = deleteTarget;
    setDeleteTarget(null);
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
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Calendar className="size-4 text-primary" />
          Calendar
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" title="New event (T)" onClick={() => openCreate()}>
            <Plus className="size-4" />
          </Button>
          {onClose && (
            <Button size="icon-sm" variant="ghost" title="Close calendar" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <Calendar className="size-6" />
            <p className="text-sm">No upcoming events.</p>
            <Button size="sm" variant="outline" onClick={() => openCreate()}>New event</Button>
          </div>
        ) : (
          <div className="space-y-4 p-3">
            {[...grouped.entries()].map(([day, evs]) => (
              <div key={day}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {dayLabel(evs[0].startTime!)}
                </p>
                <div className="space-y-1">
                  {evs.map((ev) => (
                    <div key={ev.id}>
                      <button
                        onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50",
                          expanded === ev.id && "bg-muted",
                          ev.status === "cancelled" && "opacity-40 line-through"
                        )}
                      >
                        <p className="truncate text-sm font-medium">{ev.title ?? "(no title)"}</p>
                        <p className="text-xs text-muted-foreground">{timeRange(ev)}</p>
                      </button>

                      {expanded === ev.id && (
                        <div className="mx-1 rounded-b-md border border-t-0 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
                          {ev.location && <p>📍 {ev.location}</p>}
                          {ev.description && <p className="line-clamp-3">{ev.description}</p>}
                          {ev.attendees.length > 0 && (
                            <div className="flex items-start gap-1">
                              <Users className="mt-0.5 size-3 shrink-0" />
                              <p className="leading-relaxed">
                                {ev.attendees.map((a) => a.name ?? a.email).join(", ")}
                              </p>
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            {ev.meetingLink && (
                              <a
                                href={ev.meetingLink}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="size-3" /> Join Meet
                              </a>
                            )}
                            <button
                              className="text-primary hover:underline"
                              onClick={() => setBriefEvent(briefEvent === ev.id ? null : ev.id)}
                            >
                              ✦ brief
                            </button>
                            <button
                              className="text-primary hover:underline"
                              onClick={() => openReschedule(ev)}
                            >
                              reschedule
                            </button>
                            <button
                              className="ml-auto flex items-center gap-1 text-destructive hover:underline disabled:opacity-50"
                              disabled={deletingId === ev.id}
                              onClick={() => setDeleteTarget(ev)}
                            >
                              <Trash2 className="size-3" />
                              {deletingId === ev.id ? "deleting…" : "delete"}
                            </button>
                          </div>
                          {briefEvent === ev.id && (
                            <div className="pt-2">
                              <PreMeetingBrief
                                event={{ id: ev.id, title: ev.title, startTime: ev.startTime, aiBrief: ev.aiBrief }}
                                onClose={() => setBriefEvent(null)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateEventModal
        key={editId ?? "new"}
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
