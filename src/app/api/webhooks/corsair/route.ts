import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections, webhookEvents } from "@/lib/db/schema";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar } from "@/lib/sync/calendar";
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

type WebhookPayload = Record<string, unknown> & {
  tenantId?: string;
  tenant_id?: string;
  userId?: string;
  user_id?: string;
  type?: string;
  event?: string;
  event_type?: string;
};

function pick(p: WebhookPayload, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

// Corsair forwards provider events here. We treat each as a "something changed"
// signal: idempotently sync the few newest items and push over SSE.
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
  const eventType = pick(payload, ["type", "event", "event_type"]) ?? "unknown";
  if (!userId) return new Response("OK"); // can't route without a tenant

  const source = eventType.toLowerCase().includes("gmail") ? "gmail" : "gcal";
  const resourceId =
    pick(payload, ["messageId", "message_id", "eventId", "event_id", "id"]) ?? eventType;

  // Dedup: skip resources we've already fully processed.
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
      resourceId: resourceId.slice(0, 255),
      rawPayload: payload,
    })
    .returning({ id: webhookEvents.id });

  try {
    if (source === "gmail") {
      const { created } = await syncGmail(userId, 10);
      if (created > 0) await classifyUnclassified(userId, created);
      broadcastToUser(userId, { type: "gmail.message.received", count: created });
    } else {
      const [cal] = await db
        .select({ connectedEmail: corsairConnections.connectedEmail })
        .from(corsairConnections)
        .where(
          and(
            eq(corsairConnections.userId, userId),
            eq(corsairConnections.provider, "googlecalendar")
          )
        );
      await syncCalendar(userId, cal?.connectedEmail);
      broadcastToUser(userId, { type: "gcal.event.updated" });
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
