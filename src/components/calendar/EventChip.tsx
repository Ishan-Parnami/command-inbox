"use client";

import type { CSSProperties, MouseEvent } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { CalEvent } from "./types";

export function EventChip({
  event,
  onClick,
  variant = "month",
  style,
}: {
  event: CalEvent;
  onClick: (e: MouseEvent) => void;
  variant?: "month" | "time";
  style?: CSSProperties;
}) {
  const start = event.startTime ? new Date(event.startTime) : null;
  const cancelled = event.status === "cancelled";
  const title = event.title?.trim() || "(no title)";

  if (variant === "time") {
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={cn(
          "absolute overflow-hidden rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-left leading-tight text-foreground transition-colors hover:bg-primary/25",
          cancelled && "line-through opacity-50"
        )}
      >
        <span className="block truncate text-[11px] font-medium">{title}</span>
        {start && !event.isAllDay && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {format(start, "h:mm a")}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-muted",
        cancelled && "line-through opacity-50"
      )}
    >
      {!event.isAllDay && start ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">{format(start, "h:mm")}</span>
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      )}
      <span className="truncate">{title}</span>
    </button>
  );
}
