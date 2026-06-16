import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { syncCalendar } from "@/lib/sync/calendar";

function cronAuthorized(req: Request): boolean {
  return (
    req.headers.get("x-vercel-cron") !== null ||
    (!!process.env.CRON_SECRET &&
      req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`)
  );
}

// Re-sync calendar mirrors for every connected user (every 15 min on Vercel).
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const conns = await db
    .select({ userId: corsairConnections.userId, email: corsairConnections.connectedEmail })
    .from(corsairConnections)
    .where(eq(corsairConnections.provider, "googlecalendar"));

  let synced = 0;
  let events = 0;
  for (const conn of conns) {
    try {
      events += await syncCalendar(conn.userId, conn.email);
      synced++;
    } catch (e) {
      console.error(`[cron/calendar-sync] user ${conn.userId}:`, e);
    }
  }

  return NextResponse.json({ users: conns.length, synced, events });
}
