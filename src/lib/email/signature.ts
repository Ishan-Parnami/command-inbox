/** Append a sign-off with the sender's name if not already present. */
export function withEmailSignature(body: string, senderName: string | null | undefined): string {
  const name = senderName?.trim();
  if (!name) return body;

  const trimmed = body.trimEnd();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(name.toLowerCase()) || lower.includes(`\n${name.toLowerCase()}`)) {
    return body;
  }

  return `${trimmed}\n\nBest,\n${name}`;
}
