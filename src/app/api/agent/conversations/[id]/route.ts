import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConversations } from "@/lib/db/schema";

// Returns a single conversation's full message transcript so the UI can reopen it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [row] = await db
    .select({ id: agentConversations.id, messages: agentConversations.messages })
    .from(agentConversations)
    .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, session.user.id)));

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ id: row.id, messages: row.messages ?? [] });
}

// Deletes a conversation owned by the current user.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  await db
    .delete(agentConversations)
    .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
