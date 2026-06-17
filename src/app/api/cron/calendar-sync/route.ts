import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { syncCalendar } from "@/lib/sync/calendar";
import { isAuthorizedCron } from "@/lib/cron-auth";

// Re-sync calendar mirrors for every connected user. Schedule every ~15 min.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
