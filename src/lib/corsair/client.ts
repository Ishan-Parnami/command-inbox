import "server-only";
import { createClient, type RunResult } from "@corsair-dev/app";
import { parseSearchQuery } from "@/lib/search/query";

// ── Hosted Corsair client (singleton) ─────────────────────────────────────────
// Corsair stores OAuth tokens server-side per tenant.
const client = createClient({ apiKey: process.env.CORSAIR_DEV_KEY! });
const instance = client.instance(process.env.CORSAIR_INSTANCE_ID!);

/** TenantScope for a given app user. Tenant id == our user id. */
export function tenant(tenantId: string) {
  return instance.tenant(tenantId);
}

/**
 * Unwrap a `tenant.run()` result. Throws {@link CorsairAuthError} carrying the
 * Corsair-hosted sign-in link when the user hasn't connected the provider yet,
 * so route handlers can redirect to it.
 */
export class CorsairAuthError extends Error {
  constructor(public signInLink: string) {
    super("Corsair connection required");
    this.name = "CorsairAuthError";
  }
}

function unwrap<T>(res: RunResult<T>): T {
  if (!res.success) throw new CorsairAuthError(res.signInLink);
  return res.data;
}

// ── OAuth / connection ────────────────────────────────────────────────────────
export type Provider = "gmail" | "googlecalendar";

/** Hosted authorize URL for connecting a single provider. */
export async function authorizeUrl(
  userId: string,
  provider: Provider,
  returnTo?: string
): Promise<string> {
  const { authorizeUrl } = await tenant(userId).plugins.oauth.authorizeUrl(provider, returnTo);
  return authorizeUrl;
}

/** Self-service connect link covering all installed plugins for the tenant. */
export async function connectLink(userId: string): Promise<string> {
  const link = await tenant(userId).connectLink.create();
  return link.url;
}

// ── Gmail ──────────────────────────────────────────────────────────────────────
// Operation paths verified against api.corsair.dev/md/integrations/gmail.
// Inputs follow the native Gmail REST shape; confirm per-op fields at
// api.corsair.dev/md/integrations/<path> when extending.

export function listMessages(userId: string, input: { maxResults?: number; q?: string; pageToken?: string }) {
  return tenant(userId).run("gmail.api.messages.list", input).then(unwrap);
}

export function getMessage(userId: string, id: string) {
  return tenant(userId).run("gmail.api.messages.get", { id, format: "full" }).then(unwrap);
}

export function getThread(userId: string, id: string) {
  return tenant(userId).run("gmail.api.threads.get", { id, format: "full" }).then(unwrap);
}

/** Gmail REST message ids are hex strings without dashes (not Corsair DB uuids). */
export function isGmailApiId(id: string): boolean {
  return /^[0-9a-f]{10,}$/i.test(id);
}

// Recursively find the first hex Gmail id stored under a key matching `keyRe`.
// Corsair DB rows vary in shape (flat columns vs nested message objects), so we
// scan a few levels deep instead of assuming fixed top-level keys.
function deepFindHexByKey(value: unknown, keyRe: RegExp, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindHexByKey(item, keyRe, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const row = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) {
    if (keyRe.test(k) && typeof v === "string" && isGmailApiId(v)) return v;
  }
  for (const v of Object.values(row)) {
    if (v && typeof v === "object") {
      const found = deepFindHexByKey(v, keyRe, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Corsair DB row → Gmail API message id (hex) when present, scanning nested shapes. */
export function pickGmailApiMessageId(row: Record<string, unknown>): string | null {
  return deepFindHexByKey(row, /(?:^id$|message.?id|gmail.?id|google.?id|external.?id)/i);
}

/** Corsair DB row → Gmail thread id (hex) when present, scanning nested shapes. */
export function pickGmailThreadId(row: Record<string, unknown>): string | null {
  return deepFindHexByKey(row, /thread.?id/i);
}

/**
 * Corsair-cached local Gmail search (sub-second, no live Gmail round-trip).
 * The synced DB filters by column with operators (no free-text "query" column),
 * so we match `subject`/`body`/`from` with `contains` and merge unique results.
 */
export async function searchCachedMessages(
  userId: string,
  query: string,
  limit = 20
): Promise<Array<Record<string, unknown>>> {
  const t = tenant(userId);
  const { text, from } = parseSearchQuery(query);

  type SearchSpec = { field: "subject" | "body" | "from"; value: string };
  const specs: SearchSpec[] = [];

  if (from) specs.push({ field: "from", value: from });
  const freeText = text || (!from ? query : "");
  if (freeText) {
    specs.push({ field: "subject", value: freeText });
    specs.push({ field: "body", value: freeText });
    if (!from) specs.push({ field: "from", value: freeText });
  }

  const runSearch = async (field: SearchSpec["field"], value: string, strict: boolean) => {
    const res = await t.run<Array<Record<string, unknown>>>("gmail.db.messages.search", {
      data: { [field]: { contains: value } },
      limit,
    });
    if (!res.success) {
      if (strict) throw new CorsairAuthError(res.signInLink);
      return [];
    }
    return res.data ?? [];
  };

  const batches = await Promise.all(
    specs.map(({ field, value }, i) => runSearch(field, value, i === 0))
  );

  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const rows of batches) {
    for (const row of rows) {
      const key = typeof row.id === "string" ? row.id : JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

/** Send a message. `raw` is an RFC-2822 message, base64url-encoded (Gmail contract). */
export function sendMessage(userId: string, raw: string, threadId?: string) {
  return tenant(userId).run("gmail.api.messages.send", { raw, threadId }).then(unwrap);
}

function modifyMessage(userId: string, id: string, addLabelIds: string[], removeLabelIds: string[]) {
  return tenant(userId).run("gmail.api.messages.modify", { id, addLabelIds, removeLabelIds }).then(unwrap);
}

export const archiveMessage = (userId: string, id: string) => modifyMessage(userId, id, [], ["INBOX"]);
export const markRead = (userId: string, id: string) => modifyMessage(userId, id, [], ["UNREAD"]);
export const markUnread = (userId: string, id: string) => modifyMessage(userId, id, ["UNREAD"], []);
export const star = (userId: string, id: string) => modifyMessage(userId, id, ["STARRED"], []);
export const unstar = (userId: string, id: string) => modifyMessage(userId, id, [], ["STARRED"]);
export const trashMessage = (userId: string, id: string) => modifyMessage(userId, id, ["TRASH"], ["INBOX"]);

// ── Google Calendar ─────────────────────────────────────────────────────────────
// Operation paths verified against api.corsair.dev/md/integrations/googlecalendar.

export function listEvents(
  userId: string,
  input: { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number }
) {
  return tenant(userId).run("googlecalendar.api.events.getMany", { calendarId: "primary", ...input }).then(unwrap);
}

export function getEvent(userId: string, eventId: string, calendarId = "primary") {
  return tenant(userId).run("googlecalendar.api.events.get", { calendarId, id: eventId }).then(unwrap);
}

export type CreateEventInput = {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: { email: string }[];
  status?: "confirmed" | "tentative" | "cancelled";
};

export async function createEvent(userId: string, input: CreateEventInput) {
  const { calendarId = "primary", ...event } = input;
  const runInput = {
    calendarId,
    event,
    // Email invites to all guests (otherwise Google creates the event silently).
    sendUpdates: "all" as const,
  };
  console.log("[corsair:createEvent] request:", JSON.stringify({ userId, ...runInput }));
  try {
    const res = await tenant(userId).run("googlecalendar.api.events.create", runInput);
    console.log("[corsair:createEvent] raw response:", JSON.stringify(res));
    if (!res.success) {
      console.error("[corsair:createEvent] failed (no success):", res);
      throw new CorsairAuthError(res.signInLink);
    }
    return res.data;
  } catch (e) {
    if (e instanceof CorsairAuthError) throw e;
    console.error("[corsair:createEvent] threw:", e instanceof Error ? { message: e.message, stack: e.stack, name: e.name } : e);
    throw e;
  }
}

export function updateEvent(
  userId: string,
  eventId: string,
  patch: Partial<CreateEventInput>,
  calendarId = "primary"
) {
  const { calendarId: _ignored, ...event } = patch;
  return tenant(userId)
    .run("googlecalendar.api.events.update", {
      calendarId,
      id: eventId,
      event,
      sendUpdates: "all",
    })
    .then(unwrap);
}

export function deleteEvent(userId: string, eventId: string, calendarId = "primary") {
  return tenant(userId)
    .run("googlecalendar.api.events.delete", { calendarId, id: eventId, sendUpdates: "all" })
    .then(unwrap);
}
