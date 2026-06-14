"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";

// Mounts the SSE channel (instant push when webhooks fire) and a 25s poll
// fallback so new mail shows up even if webhook delivery isn't wired.
export function RealtimeListener() {
  useSSE();
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/poll", { method: "POST" });
        if (!active || !res.ok) return;
        const data = await res.json();
        if (data.created > 0) queryClient.invalidateQueries({ queryKey: ["threads"] });
      } catch {
        // transient — try again next tick
      }
    };
    const id = setInterval(tick, 25_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [queryClient]);

  return null;
}
