import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars, calendarEvents, calendarEventAttendees } from "@/lib/db/schema";
import { listEvents } from "@/lib/corsair/client";

// Backfill: pull events for the primary calendar (-7d … +30d) and upsert into
// calendars / calendar_events / calendar_event_attendees. Idempotent.

type GEvent = {
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

export async function syncCalendar(userId: string, connectedEmail?: string | null): Promise<number> {
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

  const now = Date.now();
  const timeMin = new Date(now - 7 * 86_400_000).toISOString();
  const timeMax = new Date(now + 30 * 86_400_000).toISOString();
  const res = (await listEvents(userId, { timeMin, timeMax, maxResults: 50 })) as {
    items?: GEvent[];
  };
  const items = res.items ?? [];
  let synced = 0;

  for (const ev of items) {
    const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
    const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
    const startTime = startRaw ? new Date(startRaw) : null;
    const endTime = endRaw ? new Date(endRaw) : null;

    const [row] = await db
      .insert(calendarEvents)
      .values({
        calendarId: cal.id,
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

    synced++;
  }

  return synced;
}
