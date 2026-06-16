import { NextResponse } from "next/server";
import { and, eq, lt, gt } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";
import { createEvent, CorsairAuthError } from "@/lib/corsair/client";
import { upsertSingleEvent, type GEvent } from "@/lib/sync/calendar";
import { corsairConnections } from "@/lib/db/schema";

type Body = {
  title: string;
  description?: string;
  location?: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  attendees?: string[]; // email addresses
  force?: boolean; // skip conflict check
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { title, description, location, startTime, endTime, attendees = [], force } =
    (await req.json().catch(() => ({}))) as Body;

  console.log("[events/create] POST body:", JSON.stringify({ title, description, location, startTime, endTime, attendees, force }));

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

  if (conflicts.length && !force) {
    console.log("[events/create] conflicts:", JSON.stringify(conflicts));
    return NextResponse.json(
      { error: "conflict", conflicts: conflicts.map((c) => ({ title: c.title, startTime: c.startTime })) },
      { status: 409 }
    );
  }

  // Guard: only send real email addresses to Google. Raw names (e.g. unresolved
  // aliases) would otherwise trigger a Google 400.
  const validAttendees = attendees.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const eventPayload = {
    summary: title,
    description,
    location,
    start: { dateTime: startTime, timeZone: "UTC" },
    end: { dateTime: endTime, timeZone: "UTC" },
    attendees: validAttendees.map((e) => ({ email: e })),
  };

  console.log("[events/create] corsair payload:", JSON.stringify(eventPayload));

  let created: GEvent;
  try {
    created = (await createEvent(userId, eventPayload)) as GEvent;
    console.log("[events/create] success:", JSON.stringify(created));
  } catch (e) {
    if (e instanceof CorsairAuthError)
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    console.error("[events/create] Corsair error full:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
    return NextResponse.json({ error: "calendar_failed", detail: String(e) }, { status: 502 });
  }

  // Mirror the new event into the local DB synchronously so it shows up the
  // moment the client refetches — no manual refresh needed.
  try {
    const [conn] = await db
      .select({ email: corsairConnections.connectedEmail })
      .from(corsairConnections)
      .where(and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, "googlecalendar")));
    if (created?.id) await upsertSingleEvent(userId, conn?.email, created);
  } catch {
    // Non-fatal: the row will appear on the next background/webhook sync.
  }

  return NextResponse.json({ ok: true, eventId: created?.id });
}
