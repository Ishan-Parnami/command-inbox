import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { syncCalendar } from "@/lib/sync/calendar";
import { CorsairAuthError } from "@/lib/corsair/client";
import { broadcastToUser } from "@/lib/sse";

// Pull Google Calendar into the local mirror (−7d … +30d). Used on connect,
// when opening the calendar tab, and by the periodic cron.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [conn] = await db
    .select({ email: corsairConnections.connectedEmail })
    .from(corsairConnections)
    .where(
      and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, "googlecalendar"))
    );
  if (!conn) return NextResponse.json({ error: "calendar_not_connected" }, { status: 409 });

  try {
    const count = await syncCalendar(userId, conn.email);
    broadcastToUser(userId, { type: "gcal.event.updated" });
    return NextResponse.json({ ok: true, events: count });
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    throw e;
  }
}
