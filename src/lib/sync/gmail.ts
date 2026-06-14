import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads, emails } from "@/lib/db/schema";
import { listMessages, getMessage } from "@/lib/corsair/client";

// Backfill: pull recent inbox messages from Corsair (native Gmail REST shape) and
// upsert them into email_threads + emails. Idempotent — safe to re-run.

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
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

export async function syncGmail(
  userId: string,
  maxResults = 30
): Promise<{ processed: number; created: number }> {
  const list = (await listMessages(userId, { maxResults, q: "in:inbox" })) as {
    messages?: { id: string }[];
  };
  const ids = list.messages?.map((m) => m.id) ?? [];
  let processed = 0;
  let created = 0;

  for (const id of ids) {
    const msg = (await getMessage(userId, id)) as GmailMessage;
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
    if (!threadId) continue;

    const inserted = await db
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
        bodyText: bodies.text || null,
        bodyHtml: bodies.html || null,
        bodySnippet: (msg.snippet ?? bodies.text).slice(0, 500) || null,
        gmailLabels: labels,
        isSent: labels.includes("SENT"),
        receivedAt,
      })
      .onConflictDoNothing({ target: emails.gmailMessageId })
      .returning({ id: emails.id });

    processed++;
    if (inserted.length) created++;
  }

  return { processed, created };
}
