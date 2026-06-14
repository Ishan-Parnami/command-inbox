import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emails, emailThreads } from "@/lib/db/schema";

// Returns the messages of a thread (oldest → newest) for the reading pane.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, id), eq(emailThreads.userId, session.user.id)));
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const messages = await db
    .select()
    .from(emails)
    .where(eq(emails.threadId, id))
    .orderBy(asc(emails.receivedAt));

  return NextResponse.json({ thread, messages });
}
