"use client";

import { format } from "date-fns";
import { Clock, ExternalLink, MapPin, Trash2, CalendarClock, Check, X, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PreMeetingBrief } from "@/components/calendar/PreMeetingBrief";
import { cn } from "@/lib/utils";
import type { CalEvent } from "./types";

function timeRange(ev: CalEvent): string {
  if (!ev.startTime) return "";
  const start = new Date(ev.startTime);
  if (ev.isAllDay) return `${format(start, "EEE, MMM d")} · All day`;
  const end = ev.endTime ? new Date(ev.endTime) : null;
  const datePart = format(start, "EEE, MMM d");
  const timePart = end
    ? `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`
    : format(start, "h:mm a");
  return `${datePart} · ${timePart}`;
}

const RSVP_ICON: Record<string, typeof Check> = {
  accepted: Check,
  declined: X,
  tentative: HelpCircle,
};

const RSVP_COLOR: Record<string, string> = {
  accepted: "text-green-600 dark:text-green-400",
  declined: "text-destructive",
  tentative: "text-amber-600 dark:text-amber-400",
};

export function EventDetailDrawer({
  event,
  open,
  onOpenChange,
  onReschedule,
  onDelete,
  deleting,
}: {
  event: CalEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReschedule: (ev: CalEvent) => void;
  onDelete: (ev: CalEvent) => void;
  deleting: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} maskClosable>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {event && (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className={cn(event.status === "cancelled" && "line-through")}>
                {event.title?.trim() || "(no title)"}
              </SheetTitle>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                {timeRange(event)}
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {event.location && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{event.location}</span>
                </div>
              )}

              {event.meetingLink && (
                <a
                  href={event.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-4 shrink-0" /> Join Google Meet
                </a>
              )}

              {event.description && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {event.description}
                </p>
              )}

              {event.attendees.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {event.attendees.length} guest{event.attendees.length > 1 ? "s" : ""}
                  </p>
                  {event.attendees.map((a) => {
                    const Icon = RSVP_ICON[a.rsvpStatus];
                    return (
                      <div key={a.email} className="flex items-center gap-2 text-sm">
                        {Icon ? (
                          <Icon className={cn("size-3.5 shrink-0", RSVP_COLOR[a.rsvpStatus])} />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        <span className="truncate">{a.name ?? a.email}</span>
                        {a.isOrganizer && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            organizer
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t pt-3">
                <PreMeetingBrief
                  event={{
                    id: event.id,
                    title: event.title,
                    startTime: event.startTime,
                    aiBrief: event.aiBrief,
                  }}
                />
              </div>
            </div>

            <div className="flex shrink-0 gap-2 border-t p-4">
              <Button variant="outline" className="flex-1" onClick={() => onReschedule(event)}>
                <CalendarClock className="size-4" /> Reschedule
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={deleting}
                onClick={() => onDelete(event)}
              >
                <Trash2 className="size-4" /> {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
