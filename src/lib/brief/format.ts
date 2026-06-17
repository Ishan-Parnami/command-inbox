/** Strip markdown bold and return React-friendly segments (caller wraps in elements). */
export function splitBoldSegments(text: string): Array<{ bold: boolean; text: string }> {
  const parts: Array<{ bold: boolean; text: string }> = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ bold: false, text: text.slice(last, m.index) });
    parts.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ bold: false, text: text.slice(last) });
  return parts.length ? parts : [{ bold: false, text }];
}

export type BriefLine = {
  depth: 0 | 1;
  label?: string;
  body: string;
};

/** Parse AI brief plain/markdown-ish text into structured lines. */
export function parseBriefLines(brief: string): BriefLine[] {
  const lines: BriefLine[] = [];
  for (const raw of brief.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const star = trimmed.match(/^\*\s+(.+)/);
    if (star) {
      lines.push({ depth: 1, body: star[1] });
      continue;
    }

    const bullet = trimmed.match(/^[•\-]\s+(.+)/);
    if (bullet) {
      const content = bullet[1];
      const labeled = content.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/);
      if (labeled) {
        lines.push({ depth: 0, label: labeled[1].replace(/:$/, ""), body: labeled[2] || "" });
      } else {
        lines.push({ depth: 0, body: content });
      }
      continue;
    }

    lines.push({ depth: 0, body: trimmed });
  }
  return lines;
}
