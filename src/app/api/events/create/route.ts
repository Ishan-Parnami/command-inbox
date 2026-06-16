import { NextResponse } from "next/server";
import { and, eq, lt, gt } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { createEvent, CorsairAuthError } from "@/lib/corsair/client";
import { syncCalendar } from "@/lib/sync/calendar";
import { corsairConnections } from "@/lib/db/schema";

type Body = {
  title: string;
  description?: string;
  location?: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  attendees?: string[]; // email addresses
  addGoogleMeet?: boolean;
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { title, description, location, startTime, endTime, attendees = [], addGoogleMeet } =
    (await req.json().catch(() => ({}))) as Body;

  if (!title || !startTime || !endTime)
    return NextResponse.json({ error: "title, startTime, endTime required" }, { status: 400 });

  const start = new Date(startTime);
  const end = new Date(endTime);

  // Conflict detection: find events that overlap the requested window.
  const conflicts = await db
    .select({ id: calendarEvents.id, title: calendarEvents.title, startTime: calendarEvents.startTime })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        lt(calendarEvents.startTime, end),
        gt(calendarEvents.endTime, start)
      )
    );

  if (conflicts.length) {
    return NextResponse.json(
      { error: "conflict", conflicts: conflicts.map((c) => ({ title: c.title, startTime: c.startTime })) },
      { status: 409 }
    );
  }

  try {
    await createEvent(userId, {
      summary: title,
      description,
      location,
      start: { dateTime: startTime },
      end: { dateTime: endTime },
      attendees: attendees.map((e) => ({ email: e })),
      addGoogleMeet,
    });
  } catch (e) {
    if (e instanceof CorsairAuthError)
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    return NextResponse.json({ error: "calendar_failed" }, { status: 502 });
  }

  // Re-sync to get the new event (with server-assigned id) into our DB.
  const [conn] = await db
    .select({ email: corsairConnections.connectedEmail })
    .from(corsairConnections)
    .where(and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, "googlecalendar")));
  await syncCalendar(userId, conn?.email);

  return NextResponse.json({ ok: true });
}
