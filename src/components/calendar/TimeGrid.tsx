"use client";

import { useEffect, useRef } from "react";
import { endOfDay, format, isToday, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { EventChip } from "./EventChip";
import type { CalEvent } from "./types";

const HOUR_H = 48; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Positioned = {
  ev: CalEvent;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
};

function eventOverlapsDay(ev: CalEvent, day: Date): boolean {
  if (!ev.startTime) return false;
  const start = new Date(ev.startTime);
  const end = ev.endTime ? new Date(ev.endTime) : start;
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  return start <= dayEnd && end >= dayStart;
}

// Lane-pack overlapping events into side-by-side columns.
function layoutDay(events: CalEvent[], day: Date): Positioned[] {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  const timed = events
    .filter((e) => !e.isAllDay && e.startTime && eventOverlapsDay(e, day))
    .map((e) => {
      const start = new Date(e.startTime!);
      const end = e.endTime ? new Date(e.endTime) : new Date(start.getTime() + 30 * 60_000);
      const clampedStart = start < dayStart ? dayStart : start;
      const clampedEnd = end > dayEnd ? dayEnd : end;
      const startMin = clampedStart.getHours() * 60 + clampedStart.getMinutes();
      const endMin = Math.max(
        clampedEnd.getHours() * 60 + clampedEnd.getMinutes(),
        startMin + 20
      );
      return { ev: e, startMin, endMin, lane: 0, lanes: 1 } as Positioned;
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: Positioned[] = [];
  let cluster: Positioned[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of cluster) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          item.lane = c;
          colEnds[c] = item.endMin;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.lane = colEnds.length;
        colEnds.push(item.endMin);
      }
    }
    for (const item of cluster) {
      item.lanes = colEnds.length;
      out.push(item);
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of timed) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = cluster.length === 1 ? item.endMin : Math.max(clusterEnd, item.endMin);
  }
  flush();
  return out;
}

function NowLine() {
  const now = new Date();
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative h-px bg-red-500">
        <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
      </div>
    </div>
  );
}

export function TimeGrid({
  days,
  events,
  onSelectEvent,
  onSlotClick,
}: {
  days: Date[];
  events: CalEvent[];
  onSelectEvent: (ev: CalEvent) => void;
  onSlotClick?: (start: Date) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to ~7am on mount so the working day is visible.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H;
  }, []);

  const allDayByDay = days.map((day) =>
    events.filter(
      (e) => e.isAllDay && e.startTime && eventOverlapsDay(e, day)
    )
  );
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Day headers */}
      <div className="flex shrink-0 border-b">
        <div className="w-14 shrink-0" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs"
          >
            <span className="text-muted-foreground">{format(day, "EEE")}</span>
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full font-medium",
                isToday(day) ? "bg-primary text-primary-foreground" : "text-foreground"
              )}
            >
              {format(day, "d")}
            </span>
          </div>
        ))}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="flex shrink-0 border-b bg-muted/30">
          <div className="flex w-14 shrink-0 items-center justify-end pr-1.5 text-[10px] text-muted-foreground">
            all-day
          </div>
          {allDayByDay.map((list, i) => (
            <div key={days[i].toISOString()} className="flex-1 space-y-0.5 border-l p-1">
              {list.map((ev) => (
                <EventChip key={ev.id} event={ev} onClick={() => onSelectEvent(ev)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          {/* Time gutter */}
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_H }}>
                {h > 0 && (
                  <span className="absolute -top-2 right-1.5 text-[10px] text-muted-foreground">
                    {format(new Date(2000, 0, 1, h), "h a")}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const positioned = layoutDay(events, day);
            return (
              <div key={day.toISOString()} className="relative flex-1 border-l">
                {/* Hour lines + click targets */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-b border-border/50"
                    style={{ height: HOUR_H }}
                    onClick={
                      onSlotClick
                        ? () => {
                            const start = new Date(day);
                            start.setHours(h, 0, 0, 0);
                            onSlotClick(start);
                          }
                        : undefined
                    }
                  />
                ))}

                {isToday(day) && <NowLine />}

                {positioned.map((p) => {
                  const widthPct = 100 / p.lanes;
                  return (
                    <EventChip
                      key={p.ev.id}
                      event={p.ev}
                      variant="time"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(p.ev);
                      }}
                      style={{
                        top: (p.startMin / 60) * HOUR_H,
                        height: Math.max(((p.endMin - p.startMin) / 60) * HOUR_H, 18),
                        left: `calc(${p.lane * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
