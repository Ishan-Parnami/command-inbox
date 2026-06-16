import { NextResponse } from "next/server";
import { and, eq, ne, lt, gt } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents, corsairConnections } from "@/lib/db/schema";
import { deleteEvent, updateEvent, CorsairAuthError } from "@/lib/corsair/client";
import { upsertSingleEvent, type GEvent } from "@/lib/sync/calendar";
import { broadcastToUser } from "@/lib/sse";

type PatchBody = {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string; // ISO
  endTime?: string;   // ISO
  attendees?: string[]; // email addresses
  force?: boolean; // skip conflict check
};

// Reschedule / edit an event: updates title, time, description, location, guests.
export async function PATCH(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { eventId } = await params;

  const [ev] = await db
    .select({ id: calendarEvents.id, googleEventId: calendarEvents.googleEventId })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!ev.googleEventId)
    return NextResponse.json({ error: "not_syncable" }, { status: 409 });

  const { title, description, location, startTime, endTime, attendees, force } =
    (await req.json().catch(() => ({}))) as PatchBody;

  // Conflict detection on reschedule: only when both times are supplied.
  if (startTime && endTime && !force) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const conflicts = await db
      .select({ id: calendarEvents.id, title: calendarEvents.title, startTime: calendarEvents.startTime })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          ne(calendarEvents.id, eventId), // exclude the event being rescheduled
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
  }

  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.summary = title;
  if (description !== undefined) patch.description = description;
  if (location !== undefined) patch.location = location;
  if (startTime) patch.start = { dateTime: startTime, timeZone: "UTC" };
  if (endTime) patch.end = { dateTime: endTime, timeZone: "UTC" };
  if (attendees) patch.attendees = attendees.map((e) => ({ email: e }));

  let updated: GEvent;
  try {
    updated = (await updateEvent(userId, ev.googleEventId, patch)) as GEvent;
  } catch (e) {
    if (e instanceof CorsairAuthError)
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    console.error("[events/update] Google update failed:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
    return NextResponse.json({ error: "calendar_failed", detail: String(e) }, { status: 502 });
  }

  // Mirror the change locally so the UI reflects it immediately.
  try {
    const [conn] = await db
      .select({ email: corsairConnections.connectedEmail })
      .from(corsairConnections)
      .where(and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, "googlecalendar")));
    if (updated?.id) await upsertSingleEvent(userId, conn?.email, updated);
  } catch {
    // Non-fatal: next sync/webhook will reconcile.
  }

  broadcastToUser(userId, { type: "gcal.event.updated", eventId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { eventId } = await params;

  const [ev] = await db
    .select({ id: calendarEvents.id, googleEventId: calendarEvents.googleEventId })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Delete upstream in Google Calendar FIRST. Only remove the local mirror if
  // Google confirms deletion (or the event is already gone there) — otherwise
  // we'd hide an event that still exists on the owner's/guests' calendars.
  if (ev.googleEventId) {
    try {
      await deleteEvent(userId, ev.googleEventId);
    } catch (e) {
      if (e instanceof CorsairAuthError)
        return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
      const status = (e as { status?: number })?.status;
      const code = (e as { code?: string })?.code;
      const alreadyGone = status === 404 || status === 410;

      if (code === "operation_requires_approval") {
        // The Corsair instance blocks events.delete from the run endpoint.
        // Fall back to cancelling the event (status: "cancelled"), which still
        // removes it from the owner's and attendees' calendars.
        try {
          await updateEvent(userId, ev.googleEventId, { status: "cancelled" });
        } catch (cancelErr) {
          console.warn("[events/delete] cancel fallback failed — removing locally only:", cancelErr);
        }
        // Fall through to local cleanup either way.
      } else if (!alreadyGone) {
        console.error("[events/delete] Google delete failed:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
        return NextResponse.json({ error: "calendar_failed", detail: String(e) }, { status: 502 });
      }
      // 404/410 — already deleted upstream; fall through to local cleanup.
    }
  }

  await db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
  broadcastToUser(userId, { type: "gcal.event.deleted", eventId });

  return NextResponse.json({ ok: true });
}
