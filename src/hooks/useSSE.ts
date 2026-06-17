"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type SSEEvent = {
  type: string;
  [key: string]: unknown;
};

export function useSSE() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let retryDelay = 1000;

    function connect() {
      const es = new EventSource("/api/stream");
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEEvent;
          handleSSEEvent(data, queryClient);
          retryDelay = 1000;
        } catch {
          // malformed event — ignore
        }
      };

      es.onerror = () => {
        es.close();
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    }

    connect();
    return () => esRef.current?.close();
  }, [queryClient]);
}

function handleSSEEvent(event: SSEEvent, queryClient: ReturnType<typeof useQueryClient>) {
  const { type } = event;

  if (type.startsWith("gmail.") || type === "email.classified") {
    queryClient.invalidateQueries({ queryKey: ["threads"] });
  }
  if (type.startsWith("gcal.")) {
    queryClient.invalidateQueries({ queryKey: ["events"] });
  }
  if (type === "brief.ready") {
    queryClient.invalidateQueries({ queryKey: ["brief", event.eventId] });
  }
  if (type === "action_items.updated" || type === "action_items.extract_done") {
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    if (type === "action_items.extract_done") {
      window.dispatchEvent(new CustomEvent("action-items-extract-done"));
    }
  }
}
