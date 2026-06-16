import { NextResponse } from "next/server";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";
import { broadcastToUser } from "@/lib/sse";

// Called by Vercel Cron every minute to wake snoozed threads.
export async function GET(req: Request) {
  const authorized =
    req.headers.get("x-vercel-cron") !== null ||
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();

  // Find threads where snooze has expired.
  const expired = await db
    .select({ id: emailThreads.id, userId: emailThreads.userId })
    .from(emailThreads)
    .where(and(eq(emailThreads.isSnoozed, true), isNotNull(emailThreads.snoozedUntil), lte(emailThreads.snoozedUntil, now)));

  if (!expired.length) return NextResponse.json({ woken: 0 });

  // Wake them all.
  const ids = expired.map((t) => t.id);
  await db
    .update(emailThreads)
    .set({ isSnoozed: false, snoozedUntil: null, updatedAt: new Date() })
    .where(and(eq(emailThreads.isSnoozed, true), lte(emailThreads.snoozedUntil!, now)));

  // Notify each affected user.
  const userIds = [...new Set(expired.map((t) => t.userId))];
  for (const userId of userIds) {
    broadcastToUser(userId, { type: "snooze.woken", count: expired.filter((t) => t.userId === userId).length });
  }

  return NextResponse.json({ woken: ids.length });
}
