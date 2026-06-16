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

// Suggestions appear only after typing @ — uniform across compose, calendar, agent, natural input.
export function useContactSuggestions(value: string) {
  const { data } = useContacts();
  const contacts = data?.contacts ?? [];
  const alreadyEmails = committedEmails(value);

  const at = value.lastIndexOf("@");
  if (at === -1) return { token: "", suggestions: [] as Contact[] };
  const token = value.slice(at + 1).trim().toLowerCase();
  if (!token || /\s/.test(token)) return { token: "", suggestions: [] as Contact[] };

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

// Insert a picked contact at the active @mention. `trailing` is appended after the label (e.g. ", ").
export function applyContactMention(value: string, contact: Contact, trailing = " ") {
  const at = value.lastIndexOf("@");
  const label = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
  if (at === -1) return `${value}${label}${trailing}`;
  return `${value.slice(0, at)}${label}${trailing}`;
}

/** Extract resolved email addresses from a To/Cc/attendees field (supports @mentions and plain emails). */
export function parseRecipientField(value: string): string[] {
  const emails: string[] = [];
  for (const m of value.matchAll(/<([^>]+@[^>]+)>/g)) {
    const e = m[1].trim();
    if (EMAIL_RE.test(e)) emails.push(e);
  }
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (EMAIL_RE.test(part)) emails.push(part);
  }
  return emails;
}

/** True when a comma segment is not a resolved email or @mention label. */
export function hasUnresolvedRecipients(value: string): boolean {
  if (!value.trim()) return false;
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (/<[^>]+@[^>]+>/.test(part)) continue;
    if (EMAIL_RE.test(part)) continue;
    return true;
  }
  return false;
}
