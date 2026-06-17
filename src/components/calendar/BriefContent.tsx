"use client";

import { parseBriefLines, splitBoldSegments } from "@/lib/brief/format";
import { cn } from "@/lib/utils";

function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitBoldSegments(text).map((seg, i) =>
        seg.bold ? (
          <strong key={i} className="font-medium text-foreground">
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

export function BriefContent({ brief, className }: { brief: string; className?: string }) {
  const lines = parseBriefLines(brief);

  return (
    <ul className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {lines.map((line, i) => (
        <li
          key={i}
          className={cn(
            "flex gap-2",
            line.depth === 1 && "ml-4 list-none"
          )}
        >
          <span className="mt-0.5 shrink-0 text-primary" aria-hidden>
            {line.depth === 1 ? "◦" : "•"}
          </span>
          <span className="min-w-0 text-muted-foreground">
            {line.label ? (
              <>
                <span className="font-medium text-foreground">{line.label}</span>
                {line.body ? (
                  <>
                    {": "}
                    <InlineText text={line.body} />
                  </>
                ) : null}
              </>
            ) : (
              <InlineText text={line.body} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
