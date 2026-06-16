"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Contact } from "@/hooks/useContactSuggestions";

export function useContactSuggestionKeyboard(
  suggestions: Contact[],
  onPick: (contact: Contact) => void,
  active: boolean
) {
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    setHighlightIndex(0);
  }, [suggestions]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!active || suggestions.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === "Enter" && suggestions[highlightIndex]) {
      e.preventDefault();
      onPick(suggestions[highlightIndex]);
      return true;
    }
    if (e.key === "Tab" && suggestions[highlightIndex]) {
      e.preventDefault();
      onPick(suggestions[highlightIndex]);
      return true;
    }
    return false;
  };

  return { highlightIndex, handleKeyDown };
}

export function ContactSuggestionList({
  suggestions,
  highlightIndex,
  onPick,
  position = "below",
}: {
  suggestions: Contact[];
  highlightIndex: number;
  onPick: (contact: Contact) => void;
  position?: "above" | "below";
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul
      className={cn(
        "absolute left-0 right-0 z-50 max-h-48 overflow-auto rounded-md border bg-popover py-1 shadow-md",
        position === "above" ? "bottom-full mb-0.5" : "top-full mt-0.5"
      )}
    >
      {suggestions.map((c, i) => (
        <li key={c.email}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            className={cn(
              "flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent",
              i === highlightIndex && "bg-accent"
            )}
          >
            <span className="font-medium">{c.name || c.email}</span>
            {c.name && <span className="text-xs text-muted-foreground">{c.email}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
