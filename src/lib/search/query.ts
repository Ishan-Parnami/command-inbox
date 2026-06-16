/** Parse natural-language inbox queries into structured search terms. */
export function parseSearchQuery(q: string): { text: string; from?: string } {
  const trimmed = q.trim();
  if (!trimmed) return { text: "" };

  const fromColon = trimmed.match(/\bfrom:(\S+)/i);
  if (fromColon) {
    return {
      text: trimmed.replace(fromColon[0], "").trim(),
      from: fromColon[1],
    };
  }

  const fromNatural =
    trimmed.match(/(?:^|\b)(?:mail|email|emails?|messages?)\s+from\s+(\S+)/i) ??
    trimmed.match(/(?:^|\b)from\s+(\S+)/i);
  if (fromNatural) {
    return {
      text: trimmed.replace(fromNatural[0], "").trim(),
      from: fromNatural[1],
    };
  }

  return { text: trimmed };
}
