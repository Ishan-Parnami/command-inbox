import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads, emails } from "@/lib/db/schema";
import {
  getMessage,
  getThread,
  isGmailApiId,
  pickGmailApiMessageId,
  pickGmailThreadId,
  listMessages,
} from "@/lib/corsair/client";
import { upsertContacts } from "@/lib/sync/contacts";

// Backfill: pull recent inbox messages from Corsair (native Gmail REST shape) and
// upsert them into email_threads + emails. Idempotent — safe to re-run.

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

function getHeader(headers: GmailHeader[] = [], name: string) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decode(data?: string) {
  if (!data) return "";
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function collectBodies(part: GmailPart | undefined, out = { text: "", html: "" }) {
  if (!part) return out;
  const mt = part.mimeType ?? "";
  if (mt === "text/plain" && part.body?.data) out.text += decode(part.body.data);
  else if (mt === "text/html" && part.body?.data) out.html += decode(part.body.data);
  part.parts?.forEach((p) => collectBodies(p, out));
  return out;
}

function parseAddress(v: string | null): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: v.trim().toLowerCase() };
}

function parseList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => parseAddress(s).email)
    .filter((e): e is string => !!e);
}

function asGmailMessage(row: Record<string, unknown>): GmailMessage | null {
  if (row.payload && typeof row.id === "string" && typeof row.threadId === "string") {
    return row as unknown as GmailMessage;
  }
  return null;
}

function flatRowToGmailMessage(row: Record<string, unknown>): GmailMessage | null {
  const gmailMessageId = pickGmailApiMessageId(row) ?? (typeof row.id === "string" ? row.id : null);
  if (!gmailMessageId) return null;
  const gmailThreadId = pickGmailThreadId(row) ?? gmailMessageId;

  const subject = typeof row.subject === "string" ? row.subject.trim() : null;
  const fromRaw = typeof row.from === "string" ? row.from : null;
  const bodyText =
    (typeof row.body === "string" ? row.body : null) ??
    (typeof row.snippet === "string" ? row.snippet : null);
  if (!subject && !bodyText) return null;
  const internalDate =
    typeof row.internalDate === "string" || typeof row.internalDate === "number"
      ? String(row.internalDate)
      : undefined;

  const headers: GmailHeader[] = [];
  if (subject) headers.push({ name: "Subject", value: subject });
  if (fromRaw) headers.push({ name: "From", value: fromRaw });

  return {
    id: gmailMessageId,
    threadId: gmailThreadId,
    snippet: bodyText?.slice(0, 500) ?? undefined,
    internalDate,
    labelIds: Array.isArray(row.labelIds) ? (row.labelIds as string[]) : undefined,
    payload: { headers },
  };
}

/** Upsert one Gmail-shaped message. Returns internal thread UUID. */
export async function upsertGmailMessage(
  userId: string,
  msg: GmailMessage
): Promise<{ threadId: string; created: boolean }> {
  const headers = msg.payload?.headers ?? [];
  const from = parseAddress(getHeader(headers, "From"));
  const subject = getHeader(headers, "Subject");
  const bodies = collectBodies(msg.payload);
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
  const receivedIso = receivedAt?.toISOString() ?? null;
  const labels = msg.labelIds ?? [];
  const snippet = msg.snippet?.slice(0, 300) ?? null;

  const upserted = await db
    .insert(emailThreads)
    .values({
      userId,
      gmailThreadId: msg.threadId,
      subject,
      snippet,
      participantEmails: from.email ? [from.email] : [],
      isRead: !labels.includes("UNREAD"),
      isStarred: labels.includes("STARRED"),
      gmailLabels: labels,
      lastMessageAt: receivedAt,
    })
    .onConflictDoUpdate({
      target: [emailThreads.userId, emailThreads.gmailThreadId],
      set: {
        subject,
        snippet,
        isRead: !labels.includes("UNREAD"),
        isStarred: labels.includes("STARRED"),
        gmailLabels: labels,
        lastMessageAt: receivedAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${emailThreads.lastMessageAt} is null or ${emailThreads.lastMessageAt} < ${receivedIso}::timestamptz`,
    })
    .returning({ id: emailThreads.id });

  let threadId = upserted[0]?.id;
  if (!threadId) {
    const [existing] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(and(eq(emailThreads.userId, userId), eq(emailThreads.gmailThreadId, msg.threadId)));
    threadId = existing?.id;
  }
  if (!threadId) throw new Error("failed to upsert thread");

  const [existingEmail] = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.gmailMessageId, msg.id))
    .limit(1);

  await db
    .insert(emails)
    .values({
      threadId,
      userId,
      gmailMessageId: msg.id,
      fromEmail: from.email,
      fromName: from.name,
      toEmails: parseList(getHeader(headers, "To")),
      ccEmails: parseList(getHeader(headers, "Cc")),
      subject,
      bodyText: bodies.text || msg.snippet || null,
      bodyHtml: bodies.html || null,
      bodySnippet: (msg.snippet ?? bodies.text)?.slice(0, 500) || null,
      gmailLabels: labels,
      isSent: labels.includes("SENT"),
      receivedAt,
    })
    .onConflictDoUpdate({
      target: emails.gmailMessageId,
      set: {
        threadId,
        subject,
        bodyText: bodies.text || msg.snippet || null,
        bodyHtml: bodies.html || null,
        bodySnippet: (msg.snippet ?? bodies.text)?.slice(0, 500) || null,
        fromEmail: from.email,
        fromName: from.name,
        receivedAt,
      },
    });

  if (!existingEmail && from.email) {
    upsertContacts(userId, [{ email: from.email, name: from.name ?? null, receivedAt }]).catch(() => {});
  }

  return { threadId, created: !existingEmail };
}

/** Upsert from a Corsair DB search/get row (flat or Gmail API shape). */
export async function syncGmailMessageFromRow(
  userId: string,
  row: Record<string, unknown>
): Promise<{ threadId: string; created: boolean }> {
  const msg = asGmailMessage(row) ?? flatRowToGmailMessage(row);
  if (!msg) throw new Error("unrecognized cache row shape");
  return upsertGmailMessage(userId, msg);
}

/** Fetch via Gmail API and mirror one message. */
export async function syncGmailMessage(
  userId: string,
  gmailMessageId: string
): Promise<{ threadId: string; created: boolean }> {
  const msg = (await getMessage(userId, gmailMessageId)) as GmailMessage;
  return upsertGmailMessage(userId, msg);
}

/** Mirror all messages in a Gmail thread. */
export async function syncGmailThread(
  userId: string,
  gmailThreadId: string
): Promise<{ threadId: string }> {
  const thread = (await getThread(userId, gmailThreadId)) as {
    id: string;
    messages?: GmailMessage[];
  };
  const messages = thread.messages ?? [];
  if (!messages.length) throw new Error("thread has no messages");

  let threadId = "";
  for (const msg of messages) {
    const result = await upsertGmailMessage(userId, msg);
    threadId = result.threadId;
  }
  if (!threadId) throw new Error("failed to sync thread");
  return { threadId };
}

/** Gmail API search fallback when Corsair cache only has internal ids. */
async function findGmailMessageByHint(
  userId: string,
  hint: { subject?: string | null; from?: string | null; body?: string | null }
): Promise<string | null> {
  const qParts: string[] = [];
  if (hint.subject?.trim()) {
    const subj = hint.subject.trim().replace(/"/g, "");
    qParts.push(`subject:"${subj.slice(0, 100)}"`);
  }
  const fromEmail = hint.from ? parseAddress(hint.from).email : null;
  if (fromEmail) qParts.push(`from:${fromEmail}`);
  if (!qParts.length && hint.body?.trim()) {
    const words = hint.body.trim().replace(/"/g, "").split(/\s+/).slice(0, 10).join(" ");
    if (words.length >= 4) qParts.push(`"${words}"`);
  }
  if (!qParts.length) return null;

  const list = (await listMessages(userId, { q: qParts.join(" "), maxResults: 10 })) as {
    messages?: { id: string }[];
  };
  return list.messages?.[0]?.id ?? null;
}

function cacheRowHasContent(row: Record<string, unknown>): boolean {
  const subject = typeof row.subject === "string" ? row.subject.trim() : "";
  const body =
    (typeof row.body === "string" ? row.body.trim() : "") ||
    (typeof row.snippet === "string" ? row.snippet.trim() : "");
  return subject.length > 0 || body.length > 20;
}

export type ResolveSearchInput = {
  gmailMessageId?: string;
  cacheMessageId?: string;
  gmailThreadId?: string;
  cacheRow?: Record<string, unknown>;
};

/** Resolve a search hit: Gmail API id, cache row from search, thread sync, then hint search. */
export async function resolveSearchMessage(
  userId: string,
  input: ResolveSearchInput
): Promise<{ threadId: string }> {
  const { gmailMessageId, gmailThreadId, cacheRow } = input;

  const apiCandidates = [
    gmailMessageId,
    pickGmailApiMessageId(cacheRow ?? {}),
  ].filter((id): id is string => !!id && isGmailApiId(id));

  for (const apiId of apiCandidates) {
    try {
      return await syncGmailMessage(userId, apiId);
    } catch {
      // try next strategy
    }
  }

  const threadCandidate = gmailThreadId ?? pickGmailThreadId(cacheRow ?? {});
  if (threadCandidate && isGmailApiId(threadCandidate)) {
    try {
      return await syncGmailThread(userId, threadCandidate);
    } catch {
      // try next strategy
    }
  }

  if (cacheRow) {
    const hintId = await findGmailMessageByHint(userId, {
      subject: typeof cacheRow.subject === "string" ? cacheRow.subject : null,
      from: typeof cacheRow.from === "string" ? cacheRow.from : null,
      body:
        (typeof cacheRow.body === "string" ? cacheRow.body : null) ??
        (typeof cacheRow.snippet === "string" ? cacheRow.snippet : null),
    });
    if (hintId) {
      try {
        return await syncGmailMessage(userId, hintId);
      } catch {
        // try cache row fallback
      }
    }

    if (cacheRowHasContent(cacheRow)) {
      try {
        return await syncGmailMessageFromRow(userId, cacheRow);
      } catch {
        // exhausted
      }
    }
  }

  throw new Error("could not resolve message");
}

export async function syncGmail(
  userId: string,
  maxResults = 50
): Promise<{ processed: number; created: number }> {
  const list = (await listMessages(userId, { maxResults, q: "in:inbox" })) as {
    messages?: { id: string }[];
  };
  const ids = list.messages?.map((m) => m.id) ?? [];
  let processed = 0;
  let created = 0;

  for (const id of ids) {
    const result = await syncGmailMessage(userId, id);
    processed++;
    if (result.created) created++;
  }

  return { processed, created };
}
