"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Contact } from "@/hooks/useContactSuggestions";

export function useContactSuggestionKeyboard(
  suggestions: Contact[],
  onPick: (contact: Contact) => void,
  active: boolean
) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const suggestionKey = useMemo(() => suggestions.map((s) => s.email).join("\0"), [suggestions]);

  // Reset the highlight when the suggestion set changes (adjust state during
  // render rather than in an effect, per React guidance).
  const [prevKey, setPrevKey] = useState(suggestionKey);
  if (prevKey !== suggestionKey) {
    setPrevKey(suggestionKey);
    setHighlightIndex(0);
  }

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
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  if (suggestions.length === 0) return null;
  return (
    <ul
      ref={listRef}
      className={cn(
        "absolute left-0 right-0 z-50 max-h-48 overflow-auto rounded-md border bg-popover py-1 shadow-md",
        position === "above" ? "bottom-full mb-0.5" : "top-full mt-0.5"
      )}
    >
      {suggestions.map((c, i) => (
        <li key={c.email}>
          <button
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            className={cn(
              "flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent",
              i === highlightIndex && "bg-accent ring-1 ring-inset ring-primary/30"
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
