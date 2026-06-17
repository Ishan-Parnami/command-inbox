/** Strip natural-language wrappers so keyword search matches real subjects/snippets. */
export function normalizeSearchText(q: string): string {
  let t = q.trim();
  if (!t) return "";

  if (
    (t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
    (t.startsWith("'") && t.endsWith("'") && t.length > 1)
  ) {
    t = t.slice(1, -1).trim();
  }

  t = t.replace(
    /^(?:(?:any|some|all)\s+)?(?:(?:mails?|emails?|messages?)\s+)?(?:related\s+to|about|regarding|concerning|(?:that\s+)?(?:mention|contain|include|have)s?|with)\s+/i,
    ""
  );
  t = t.replace(/^(?:any|some)\s+/i, "");

  return t.trim();
}

/** Parse natural-language inbox queries into structured search terms. */
export function parseSearchQuery(q: string): { text: string; from?: string } {
  const trimmed = q.trim();
  if (!trimmed) return { text: "" };

  const fromColon = trimmed.match(/\bfrom:(\S+)/i);
  if (fromColon) {
    return {
      text: normalizeSearchText(trimmed.replace(fromColon[0], "").trim()),
      from: fromColon[1],
    };
  }

  const fromNatural =
    trimmed.match(/(?:^|\b)(?:mail|email|emails?|messages?)\s+from\s+(\S+)/i) ??
    trimmed.match(/(?:^|\b)from\s+(\S+)/i);
  if (fromNatural) {
    return {
      text: normalizeSearchText(trimmed.replace(fromNatural[0], "").trim()),
      from: fromNatural[1],
    };
  }

  return { text: normalizeSearchText(trimmed) };
}
