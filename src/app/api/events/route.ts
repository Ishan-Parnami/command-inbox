import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents, calendarEventAttendees } from "@/lib/db/schema";

// Returns events in a window (default: today … +7d) with their attendees.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const url = new URL(req.url);
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : new Date(new Date().setHours(0, 0, 0, 0));
  const to = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : new Date(Date.now() + 7 * 86_400_000);

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        gte(calendarEvents.startTime, from),
        lte(calendarEvents.startTime, to)
      )
    )
    .orderBy(asc(calendarEvents.startTime));

  const attendeeRows = rows.length
    ? await db
        .select()
        .from(calendarEventAttendees)
        .where(
          and(...rows.map((r) => eq(calendarEventAttendees.eventId, r.id)))
        )
    : [];

  const attendeeMap: Record<string, typeof attendeeRows> = {};
  for (const a of attendeeRows) attendeeMap[a.eventId] ??= [], attendeeMap[a.eventId].push(a);

  return NextResponse.json({
    events: rows.map((e) => ({ ...e, attendees: attendeeMap[e.id] ?? [] })),
  });
}
