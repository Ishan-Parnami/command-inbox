"use client";

import { useQuery } from "@tanstack/react-query";

export type Contact = { email: string; name: string | null };

export function useContacts() {
  return useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts"],
    queryFn: () => fetch("/api/contacts").then((r) => r.json()),
    staleTime: 60_000,
  });
}

// Given an input value, returns the token currently being typed plus matching contacts.
// separator "," = last comma segment (compose/attendees); "@" = text after last @ (agent).
export function useContactSuggestions(value: string, separator: "," | "@" = ",") {
  const { data } = useContacts();
  const contacts = data?.contacts ?? [];

  const alreadyEmails = new Set(
    [...value.matchAll(/[^\s@,]+@[^\s@,]+\.[^\s@,]+/g)].map((m) => m[0].toLowerCase())
  );

  let token = "";
  const committed: string[] = [];

  if (separator === "@") {
    const at = value.lastIndexOf("@");
    if (at === -1) return { token: "", suggestions: [] as Contact[] };
    token = value.slice(at + 1).trim().toLowerCase();
    if (!token || /\s/.test(token)) return { token: "", suggestions: [] as Contact[] };
  } else {
    const parts = value.split(",");
    token = parts[parts.length - 1]?.trim().toLowerCase() ?? "";
    committed.push(
      ...parts
        .slice(0, -1)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  if (!token) return { token: "", suggestions: [] as Contact[] };

  const isCommitted = (c: Contact) => {
    const email = c.email.toLowerCase();
    const name = (c.name ?? "").toLowerCase();
    return (
      alreadyEmails.has(email) ||
      committed.some((part) => part === email || (name && part === name))
    );
  };

  const suggestions = contacts
    .filter((c) => !isCommitted(c))
    .filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      return name.includes(token) || c.email.toLowerCase().includes(token);
    })
    .filter((c) => c.email.toLowerCase() !== token)
    .slice(0, 5);

  return { token, suggestions };
}

// Replaces the last comma-separated token in `value` with `email`, leaving a
// trailing separator so the user can keep typing the next recipient.
export function applyContactToken(value: string, email: string) {
  const parts = value.split(",");
  parts[parts.length - 1] = email;
  return parts.map((p) => p.trim()).filter(Boolean).join(", ") + ", ";
}

// Replaces an @mention token in the agent input with a contact label the AI can resolve.
export function applyAgentContactToken(value: string, contact: Contact) {
  const at = value.lastIndexOf("@");
  const label = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
  if (at === -1) return `${value}${label} `;
  return `${value.slice(0, at)}${label} `;
}
