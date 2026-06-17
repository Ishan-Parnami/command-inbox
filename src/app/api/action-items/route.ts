import { NextResponse } from "next/server";
import { after } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { actionItems } from "@/lib/db/schema";
import { extractActionItems } from "@/lib/llm/extract";
import { enforceAiQuota, QuotaExceededError } from "@/lib/billing/quota";
import { broadcastToUser } from "@/lib/sse";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  try {
    const items = await db
      .select()
      .from(actionItems)
      .where(eq(actionItems.userId, userId))
      .orderBy(desc(actionItems.createdAt))
      .limit(50);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

// POST /api/action-items — create manual item OR start background extraction
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = (await req.json().catch(() => ({}))) as {
    description?: string;
    extract?: boolean;
  };

  const description = body.description?.trim();
  if (description) {
    const [item] = await db
      .insert(actionItems)
      .values({ userId, description })
      .returning();
    broadcastToUser(userId, { type: "action_items.updated" });
    return NextResponse.json({ item });
  }

  try {
    await enforceAiQuota(userId, "action_extract");
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(e.toJSON(), {
        status: 429,
        headers: { "Retry-After": String(e.retryAfterSeconds) },
      });
    }
    throw e;
  }

  // Run extraction after the response so the user can navigate away.
  after(async () => {
    try {
      await extractActionItems(userId);
    } catch (err) {
      console.error("[action-items] background extract failed:", err);
      broadcastToUser(userId, { type: "action_items.extract_done", inserted: 0, error: true });
    }
  });

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}

// PATCH /api/action-items — mark done
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id, isDone } = (await req.json()) as { id: string; isDone: boolean };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db
    .update(actionItems)
    .set({ isDone, updatedAt: new Date() })
    .where(and(eq(actionItems.id, id), eq(actionItems.userId, userId)));

  return NextResponse.json({ ok: true });
}

// DELETE /api/action-items?id=… — hard-delete an item
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db
    .delete(actionItems)
    .where(and(eq(actionItems.id, id), eq(actionItems.userId, userId)));

  return NextResponse.json({ ok: true });
}
