import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { actionItems } from "@/lib/db/schema";
import { extractActionItems } from "@/lib/llm/extract";
import { enforceAiQuota, QuotaExceededError } from "@/lib/billing/quota";

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

// POST /api/action-items — trigger extraction
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

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

  await extractActionItems(userId);
  return NextResponse.json({ ok: true });
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
