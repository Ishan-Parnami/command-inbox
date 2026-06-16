import "server-only";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, calendarEvents, calendarEventAttendees } from "@/lib/db/schema";
import { listEvents } from "@/lib/corsair/client";

// Backfill: pull events for the primary calendar (-7d … +30d) and upsert into
// calendars / calendar_events / calendar_event_attendees. Idempotent.

export type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  organizer?: { email?: string };
  hangoutLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string; organizer?: boolean }[];
};

/** Ensure the user's primary calendar row exists; returns its internal id. */
export async function ensureCalendar(userId: string, connectedEmail?: string | null): Promise<string> {
  const googleCalId = connectedEmail ?? "primary";
  const [cal] = await db
    .insert(calendars)
    .values({
      userId,
      googleCalId,
      name: connectedEmail ?? "Primary",
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: calendars.googleCalId,
      set: { name: connectedEmail ?? "Primary", updatedAt: new Date() },
    })
    .returning({ id: calendars.id });
  return cal.id;
}

/** Upsert a single Google event (and its attendees) into the local mirror. */
export async function upsertEvent(userId: string, calId: string, ev: GEvent): Promise<void> {
  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
  const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
  const startTime = startRaw ? new Date(startRaw) : null;
  const endTime = endRaw ? new Date(endRaw) : null;

  const [row] = await db
    .insert(calendarEvents)
    .values({
      calendarId: calId,
      userId,
      googleEventId: ev.id,
      title: ev.summary?.slice(0, 500) ?? null,
      description: ev.description ?? null,
      location: ev.location?.slice(0, 500) ?? null,
      startTime,
      endTime,
      isAllDay: !!ev.start?.date,
      status: ev.status ?? "confirmed",
      organizerEmail: ev.organizer?.email ?? null,
      meetingLink: ev.hangoutLink ?? null,
    })
    .onConflictDoUpdate({
      target: calendarEvents.googleEventId,
      set: {
        title: ev.summary?.slice(0, 500) ?? null,
        description: ev.description ?? null,
        location: ev.location?.slice(0, 500) ?? null,
        startTime,
        endTime,
        status: ev.status ?? "confirmed",
        updatedAt: new Date(),
      },
    })
    .returning({ id: calendarEvents.id });

  if (ev.attendees?.length) {
    await db.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, row.id));
    await db.insert(calendarEventAttendees).values(
      ev.attendees.map((a) => ({
        eventId: row.id,
        email: a.email,
        name: a.displayName ?? null,
        rsvpStatus: a.responseStatus ?? "needsAction",
        isOrganizer: !!a.organizer,
      }))
    );
  }
}

/** Upsert a single event by its Google id, ensuring the calendar row exists. */
export async function upsertSingleEvent(
  userId: string,
  connectedEmail: string | null | undefined,
  ev: GEvent
): Promise<void> {
  const calId = await ensureCalendar(userId, connectedEmail);
  await upsertEvent(userId, calId, ev);
}

export async function syncCalendar(userId: string, connectedEmail?: string | null): Promise<number> {
  const calId = await ensureCalendar(userId, connectedEmail);

  const now = Date.now();
  const timeMin = new Date(now - 7 * 86_400_000).toISOString();
  const timeMax = new Date(now + 30 * 86_400_000).toISOString();
  const res = (await listEvents(userId, { timeMin, timeMax, maxResults: 50 })) as {
    items?: GEvent[];
  };
  const items = res.items ?? [];

  for (const ev of items) {
    await upsertEvent(userId, calId, ev);
  }

  // Reconcile deletions: any local event inside this window whose Google id is no
  // longer returned has been deleted/cancelled upstream — drop it locally too.
  const keep = new Set(items.map((e) => e.id));
  const localInWindow = await db
    .select({ id: calendarEvents.id, googleEventId: calendarEvents.googleEventId })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.calendarId, calId),
        isNotNull(calendarEvents.startTime),
        gte(calendarEvents.startTime, new Date(timeMin)),
        lte(calendarEvents.startTime, new Date(timeMax))
      )
    );
  const staleIds = localInWindow
    .filter((r) => r.googleEventId && !keep.has(r.googleEventId))
    .map((r) => r.id);
  if (staleIds.length) {
    await db.delete(calendarEvents).where(inArray(calendarEvents.id, staleIds));
  }

  return items.length;
}
