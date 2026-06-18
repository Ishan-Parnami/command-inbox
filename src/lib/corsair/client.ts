import "server-only";
import { AuthMissingError } from "corsair";
import { generateOAuthUrl, processOAuthCallback } from "corsair/oauth";
import { corsair } from "@/corsair";
import { parseSearchQuery } from "@/lib/search/query";

// ── Self-hosted Corsair client ────────────────────────────────────────────────
// OAuth tokens are stored per tenant in corsair_accounts. Tenant id == our user id.

/** Tenant-scoped SDK client for a given app user. */
export function tenant(tenantId: string) {
  return corsair.withTenant(tenantId);
}

/**
 * Thrown when a tenant hasn't connected the provider yet. `signInLink` points at
 * our own connect route, which kicks off the Google OAuth flow. Route handlers
 * return it as JSON and the frontend redirects the browser there.
 */
export class CorsairAuthError extends Error {
  constructor(public signInLink: string) {
    super("Corsair connection required");
    this.name = "CorsairAuthError";
  }
}

// ── OAuth / connection ────────────────────────────────────────────────────────
export type Provider = "gmail" | "googlecalendar";

/** Scopes Corsair requests per plugin — all must be granted or the connect fails. */
export const REQUIRED_SCOPES: Record<Provider, readonly string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  googlecalendar: ["https://www.googleapis.com/auth/calendar"],
};

export function hasRequiredScopes(scopeParam: string | null, provider: Provider): boolean {
  const granted = new Set((scopeParam ?? "").split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES[provider].every((s) => granted.has(s));
}

/** Shared OAuth redirect target. Must match the URI registered in Google Cloud. */
export function getRedirectUri(): string {
  return `${process.env.NEXT_PUBLIC_URL}/api/corsair/callback`;
}

/** Path the browser is sent to when a tenant needs to (re)connect a provider. */
function signInLinkFor(provider: Provider): string {
  const base = process.env.NEXT_PUBLIC_URL ?? "";
  return `${base}/api/corsair/connect?provider=${provider}`;
}

/** Build the Google OAuth authorize URL for this user + provider. */
export async function getAuthUrl(
  userId: string,
  provider: Provider,
  loginHint?: string
): Promise<string> {
  const { url } = await generateOAuthUrl(corsair, provider, {
    tenantId: userId,
    redirectUri: getRedirectUri(),
  });
  // Corsair OAuth is separate from NextAuth — Google may reuse whatever account
  // is signed into the browser. Keep `consent` so Google returns a refresh token
  // (required by the Corsair plugins) and add `select_account` for the picker.
  const auth = new URL(url);
  auth.searchParams.set("prompt", "consent select_account");
  if (loginHint) auth.searchParams.set("login_hint", loginHint);
  return auth.toString();
}

/** Exchange the OAuth `code`/`state` for tokens and store them for the tenant. */
export async function completeOAuth(code: string, state: string): Promise<{ plugin: string; tenantId: string }> {
  return processOAuthCallback(corsair, { code, state, redirectUri: getRedirectUri() });
}

/** True when Corsair can read credentials for this tenant (refresh token present). */
export async function verifyProviderAuth(userId: string, provider: Provider): Promise<boolean> {
  try {
    const t = tenant(userId);
    if (provider === "gmail") {
      await t.gmail.api.messages.list({ maxResults: 1 });
    } else {
      await t.googlecalendar.api.events.getMany({ calendarId: "primary", maxResults: 1 });
    }
    return true;
  } catch (e) {
    return !(e instanceof AuthMissingError);
  }
}

// Map the SDK's AuthMissingError onto our redirectable CorsairAuthError; let
// every other error propagate unchanged.
async function call<T>(provider: Provider, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthMissingError) throw new CorsairAuthError(signInLinkFor(provider));
    throw e;
  }
}

// ── Gmail ──────────────────────────────────────────────────────────────────────

export function listMessages(userId: string, input: { maxResults?: number; q?: string; pageToken?: string }) {
  return call("gmail", () => tenant(userId).gmail.api.messages.list(input));
}

export function getMessage(userId: string, id: string) {
  return call("gmail", () => tenant(userId).gmail.api.messages.get({ id, format: "full" }));
}

export function getThread(userId: string, id: string) {
  return call("gmail", () => tenant(userId).gmail.api.threads.get({ id, format: "full" }));
}

/** Gmail REST message ids are hex strings without dashes (not Corsair DB uuids). */
export function isGmailApiId(id: string): boolean {
  return /^[0-9a-f]{10,}$/i.test(id);
}

// Recursively find the first hex Gmail id stored under a key matching `keyRe`.
// Corsair rows vary in shape (flat columns vs nested objects), so we scan a few
// levels deep instead of assuming fixed top-level keys.
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

/** Corsair row → Gmail API message id (hex) when present, scanning nested shapes. */
export function pickGmailApiMessageId(row: Record<string, unknown>): string | null {
  return deepFindHexByKey(row, /(?:^id$|message.?id|gmail.?id|google.?id|external.?id)/i);
}

/** Corsair row → Gmail thread id (hex) when present, scanning nested shapes. */
export function pickGmailThreadId(row: Record<string, unknown>): string | null {
  return deepFindHexByKey(row, /thread.?id/i);
}

/**
 * Local Gmail search over Corsair's synced entities (sub-second, no Gmail
 * round-trip). The synced `data` JSONB has top-level `subject`/`body`/`from`
 * columns, so we match each with `contains` and merge unique results. Rows are
 * flattened (data spread to the top level) so existing callers keep working.
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
    try {
      return await t.gmail.db.messages.search({ data: { [field]: { contains: value } }, limit });
    } catch (e) {
      if (strict && e instanceof AuthMissingError) throw new CorsairAuthError(signInLinkFor("gmail"));
      return [];
    }
  };

  const batches = await Promise.all(specs.map(({ field, value }, i) => runSearch(field, value, i === 0)));

  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const rows of batches) {
    for (const entity of rows) {
      const data = (entity.data ?? {}) as Record<string, unknown>;
      const flat: Record<string, unknown> = {
        ...data,
        id: typeof data.id === "string" ? data.id : entity.entity_id,
      };
      const key = typeof flat.id === "string" ? flat.id : JSON.stringify(flat);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(flat);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

/** Send a message. `raw` is an RFC-2822 message, base64url-encoded (Gmail contract). */
export function sendMessage(userId: string, raw: string, threadId?: string) {
  return call("gmail", () => tenant(userId).gmail.api.messages.send({ raw, threadId }));
}

function modifyMessage(userId: string, id: string, addLabelIds: string[], removeLabelIds: string[]) {
  return call("gmail", () => tenant(userId).gmail.api.messages.modify({ id, addLabelIds, removeLabelIds }));
}

export const archiveMessage = (userId: string, id: string) => modifyMessage(userId, id, [], ["INBOX"]);
export const markRead = (userId: string, id: string) => modifyMessage(userId, id, [], ["UNREAD"]);
export const markUnread = (userId: string, id: string) => modifyMessage(userId, id, ["UNREAD"], []);
export const star = (userId: string, id: string) => modifyMessage(userId, id, ["STARRED"], []);
export const unstar = (userId: string, id: string) => modifyMessage(userId, id, [], ["STARRED"]);
export const trashMessage = (userId: string, id: string) => modifyMessage(userId, id, ["TRASH"], ["INBOX"]);

// ── Google Calendar ─────────────────────────────────────────────────────────────

export function listEvents(
  userId: string,
  input: { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number }
) {
  return call("googlecalendar", () =>
    tenant(userId).googlecalendar.api.events.getMany({ calendarId: "primary", ...input })
  );
}

export function getEvent(userId: string, eventId: string, calendarId = "primary") {
  return call("googlecalendar", () =>
    tenant(userId).googlecalendar.api.events.get({ calendarId, id: eventId })
  );
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
  try {
    // Email invites to all guests (otherwise Google creates the event silently).
    return await tenant(userId).googlecalendar.api.events.create({
      calendarId,
      event,
      sendUpdates: "all",
    });
  } catch (e) {
    if (e instanceof AuthMissingError) throw new CorsairAuthError(signInLinkFor("googlecalendar"));
    console.error(
      "[corsair:createEvent] threw:",
      e instanceof Error ? { message: e.message, name: e.name } : e
    );
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
  return call("googlecalendar", () =>
    tenant(userId).googlecalendar.api.events.update({
      calendarId,
      id: eventId,
      event,
      sendUpdates: "all",
    })
  );
}

export function deleteEvent(userId: string, eventId: string, calendarId = "primary") {
  return call("googlecalendar", () =>
    tenant(userId).googlecalendar.api.events.delete({ calendarId, id: eventId, sendUpdates: "all" })
  );
}
