"use client";

import { useQuery } from "@tanstack/react-query";

export type Contact = { email: string; name: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useContacts() {
  return useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts"],
    queryFn: () => fetch("/api/contacts").then((r) => r.json()),
    staleTime: 60_000,
  });
}

function committedEmails(value: string) {
  const emails = new Set<string>();
  for (const m of value.matchAll(/<([^>]+@[^>]+)>/g)) emails.add(m[1].trim().toLowerCase());
  for (const m of value.matchAll(/(?:^|[\s,])([^\s,@]+@[^\s,]+\.[^\s,]+)(?=[\s,]|$)/g)) {
    emails.add(m[1].toLowerCase());
  }
  return emails;
}

/** Start index of the current comma-separated recipient segment. */
function segmentStart(value: string): number {
  return Math.max(value.lastIndexOf(","), value.lastIndexOf(";")) + 1;
}

/** @mention index when @ is the first character of the active segment (not inside an email). */
function mentionAt(value: string): number {
  const start = segmentStart(value);
  const segment = value.slice(start);
  const leading = segment.length - segment.trimStart().length;
  const trimmed = segment.trimStart();
  if (!trimmed.startsWith("@")) return -1;
  return start + leading;
}

// Suggestions appear only after typing @ at the start of a recipient segment.
export function useContactSuggestions(value: string) {
  const { data } = useContacts();
  const contacts = data?.contacts ?? [];
  const alreadyEmails = committedEmails(value);

  const at = mentionAt(value);
  if (at === -1) return { token: "", suggestions: [] as Contact[] };
  const token = value.slice(at + 1).trim().toLowerCase();
  if (/\s/.test(token)) return { token: "", suggestions: [] as Contact[] };

  const suggestions = contacts
    .filter((c) => !alreadyEmails.has(c.email.toLowerCase()))
    .filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      return name.includes(token) || c.email.toLowerCase().includes(token);
    })
    .filter((c) => c.email.toLowerCase() !== token)
    .slice(0, 5);

  return { token, suggestions };
}

// Replace the active recipient segment with the picked contact.
export function applyContactMention(value: string, contact: Contact, trailing = " ") {
  const start = segmentStart(value);
  const before = value.slice(0, start);
  const label = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
  return `${before}${label}${trailing}`;
}

/** Extract resolved email addresses from a To/Cc/attendees field (supports @mentions and plain emails). */
export function parseRecipientField(value: string): string[] {
  const emails: string[] = [];
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    const bracket = part.match(/^(.+?)\s*<([^>]+@[^>]+)>$/);
    if (bracket) {
      const e = bracket[2].trim();
      if (EMAIL_RE.test(e)) emails.push(e);
      continue;
    }
    if (EMAIL_RE.test(part)) emails.push(part);
  }
  return emails;
}

/** True when a comma segment is not a resolved email or @mention label. */
export function hasUnresolvedRecipients(value: string): boolean {
  if (!value.trim()) return false;
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (/^(.+?)\s*<[^>]+@[^>]+>$/.test(part)) continue;
    if (EMAIL_RE.test(part)) continue;
    return true;
  }
  return false;
}
