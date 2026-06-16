import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  corsairConnections,
  webhookEvents,
  emails,
  emailThreads,
  calendarEvents,
} from "@/lib/db/schema";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar, upsertSingleEvent, type GEvent } from "@/lib/sync/calendar";
import { getEvent } from "@/lib/corsair/client";
import { classifyUnclassified } from "@/lib/llm/classify";
import { broadcastToUser } from "@/lib/sse";

export const dynamic = "force-dynamic";

// Optional HMAC check. Corsair signs with the per-account `webhook_signature`;
// set CORSAIR_WEBHOOK_SECRET to enforce. Skipped (dev) when unset.
function verifySignature(raw: string, sig: string | null): boolean {
  const secret = process.env.CORSAIR_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!sig) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

type AnyRecord = Record<string, unknown>;
type WebhookPayload = AnyRecord & {
  tenantId?: string;
  tenant_id?: string;
  userId?: string;
  user_id?: string;
  type?: string;
  event?: unknown;
  event_type?: string;
};

function pick(p: AnyRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

function asRecord(v: unknown): AnyRecord | undefined {
  return v && typeof v === "object" ? (v as AnyRecord) : undefined;
}

// Corsair nests the resolved webhook result in different shapes depending on the
// delivery. Collect the candidate "response" objects so we can read the precise
// granular type (e.g. messageDeleted / eventDeleted) and its fields from any of them.
function responseCandidates(p: WebhookPayload): AnyRecord[] {
  return [
    p,
    asRecord(p.event),
    asRecord(p.response),
    asRecord((asRecord(p.response) ?? {}).data),
    asRecord(p.data),
  ].filter((x): x is AnyRecord => !!x);
}

function granularType(p: WebhookPayload): string | undefined {
  for (const c of responseCandidates(p)) {
    const t = pick(c, ["type", "event_type", "eventType"]);
    if (t) return t;
  }
  return undefined;
}

function findString(p: WebhookPayload, keys: string[]): string | undefined {
  for (const c of responseCandidates(p)) {
    const direct = pick(c, keys);
    if (direct) return direct;
    const msg = asRecord(c.message);
    if (msg) {
      const fromMsg = pick(msg, keys);
      if (fromMsg) return fromMsg;
    }
    const ev = asRecord(c.event);
    if (ev) {
      const fromEv = pick(ev, keys);
      if (fromEv) return fromEv;
    }
  }
  return undefined;
}

function findStringArray(p: WebhookPayload, key: string): string[] {
  for (const c of responseCandidates(p)) {
    const v = c[key];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  }
  return [];
}

// Corsair forwards provider events here. We branch on the granular response type
// to apply the precise local mutation, falling back to a "sync newest" signal.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-corsair-signature"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const userId =
    pick(payload, ["tenantId", "tenant_id", "userId", "user_id"]) ??
    req.headers.get("x-corsair-tenant-id") ??
    undefined;
  const eventType = granularType(payload) ?? pick(payload, ["type", "event", "event_type"]) ?? "unknown";
  if (!userId) return new Response("OK"); // can't route without a tenant

  const lower = eventType.toLowerCase();
  const source = lower.includes("message") || lower.includes("gmail") ? "gmail" : "gcal";

  const messageId = findString(payload, ["messageId", "message_id", "id"]);
  const eventId = findString(payload, ["eventId", "event_id", "id"]);
  const historyId = findString(payload, ["historyId", "history_id"]);
  const baseResourceId = (source === "gmail" ? messageId : eventId) ?? eventType;

  // Dedup: distinct change types / history ids on the same resource stay distinct,
  // while genuine duplicate re-deliveries are skipped.
  const resourceId = `${baseResourceId}:${eventType}${historyId ? `:${historyId}` : ""}`.slice(0, 255);
  const existing = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.source, source),
        eq(webhookEvents.resourceId, resourceId),
        eq(webhookEvents.processed, true)
      )
    )
    .limit(1);
  if (existing.length) return new Response("Duplicate");

  const [row] = await db
    .insert(webhookEvents)
    .values({
      userId,
      source,
      eventType: eventType.slice(0, 50),
      resourceId,
      rawPayload: payload,
    })
    .returning({ id: webhookEvents.id });

  try {
    if (source === "gmail") {
      await handleGmail(userId, lower, messageId, payload);
    } else {
      await handleCalendar(userId, lower, eventId);
    }
    await db
      .update(webhookEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(webhookEvents.id, row.id));
  } catch (e) {
    await db
      .update(webhookEvents)
      .set({ errorMsg: e instanceof Error ? e.message : "error" })
      .where(eq(webhookEvents.id, row.id));
  }

  return new Response("OK");
}

async function handleGmail(
  userId: string,
  type: string,
  messageId: string | undefined,
  payload: WebhookPayload
) {
  if (type.includes("delete")) {
    if (messageId) {
      await db
        .delete(emails)
        .where(and(eq(emails.userId, userId), eq(emails.gmailMessageId, messageId)));
    }
    broadcastToUser(userId, { type: "gmail.message.deleted", messageId });
    return;
  }

  if (type.includes("label")) {
    if (messageId) {
      const added = findStringArray(payload, "labelsAdded");
      const removed = findStringArray(payload, "labelsRemoved");
      const [emailRow] = await db
        .select({ id: emails.id, threadId: emails.threadId, labels: emails.gmailLabels })
        .from(emails)
        .where(and(eq(emails.userId, userId), eq(emails.gmailMessageId, messageId)));
      if (emailRow) {
        const next = new Set(emailRow.labels ?? []);
        added.forEach((l) => next.add(l));
        removed.forEach((l) => next.delete(l));
        const labels = [...next];
        await db.update(emails).set({ gmailLabels: labels }).where(eq(emails.id, emailRow.id));
        await db
          .update(emailThreads)
          .set({
            isRead: !labels.includes("UNREAD"),
            isStarred: labels.includes("STARRED"),
            gmailLabels: labels,
            updatedAt: new Date(),
          })
          .where(eq(emailThreads.id, emailRow.threadId));
      }
    }
    broadcastToUser(userId, { type: "gmail.labels.changed", messageId });
    return;
  }

  // messageReceived (and unknown gmail types): sync the newest items + classify.
  const { created } = await syncGmail(userId, 10);
  if (created > 0) await classifyUnclassified(userId, created);
  broadcastToUser(userId, { type: "gmail.message.received", count: created });
}

async function handleCalendar(userId: string, type: string, eventId: string | undefined) {
  const [conn] = await db
    .select({ connectedEmail: corsairConnections.connectedEmail })
    .from(corsairConnections)
    .where(
      and(
        eq(corsairConnections.userId, userId),
        eq(corsairConnections.provider, "googlecalendar")
      )
    );

  if (type.includes("delete")) {
    if (eventId) {
      await db
        .delete(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.googleEventId, eventId)));
    }
    broadcastToUser(userId, { type: "gcal.event.deleted", eventId });
    return;
  }

  if ((type.includes("create") || type.includes("update")) && eventId) {
    const ev = (await getEvent(userId, eventId)) as GEvent;
    if (ev?.id) await upsertSingleEvent(userId, conn?.connectedEmail, ev);
    broadcastToUser(userId, { type: "gcal.event.updated", eventId });
    return;
  }

  // Unknown calendar type: fall back to a window re-sync.
  await syncCalendar(userId, conn?.connectedEmail);
  broadcastToUser(userId, { type: "gcal.event.updated" });
}
