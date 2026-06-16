import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { actionItems } from "@/lib/db/schema";
import { extractActionItems } from "@/lib/llm/extract";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const items = await db
    .select()
    .from(actionItems)
    .where(and(eq(actionItems.userId, userId), eq(actionItems.isDone, false)))
    .orderBy(desc(actionItems.createdAt))
    .limit(50);

  return NextResponse.json({ items });
}

// POST /api/action-items — trigger extraction
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

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
