"use client";

import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";
import { EventChip } from "./EventChip";
import type { CalEvent } from "./types";

const MAX_PER_DAY = 3;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({
  anchorDate,
  events,
  onSelectEvent,
  onSelectDay,
}: {
  anchorDate: Date;
  events: CalEvent[];
  onSelectEvent: (ev: CalEvent) => void;
  onSelectDay?: (day: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(anchorDate));
  const gridEnd = endOfWeek(endOfMonth(anchorDate));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventsForDay = (day: Date) =>
    events
      .filter((e) => e.startTime && isSameDay(new Date(e.startTime), day))
      .sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime());

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5 text-center text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsForDay(day);
          const inMonth = isSameMonth(day, anchorDate);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 border-b border-l p-1 nth-[7n+1]:border-l-0",
                !inMonth && "bg-muted/30"
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay?.(day)}
                className="flex items-center self-start"
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px]",
                    isToday(day)
                      ? "bg-primary font-medium text-primary-foreground"
                      : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  {format(day, "d")}
                </span>
              </button>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {dayEvents.slice(0, MAX_PER_DAY).map((ev) => (
                  <EventChip key={ev.id} event={ev} onClick={() => onSelectEvent(ev)} />
                ))}
                {dayEvents.length > MAX_PER_DAY && (
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(day)}
                    className="px-1 text-[10px] text-muted-foreground hover:underline"
                  >
                    +{dayEvents.length - MAX_PER_DAY} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
