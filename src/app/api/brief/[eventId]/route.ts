import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents, calendarEventAttendees, emails } from "@/lib/db/schema";
import { generateText } from "@/lib/gemini/client";
import { enforceAiQuota, QuotaExceededError } from "@/lib/billing/quota";

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { eventId } = await params;
  const regenerate = new URL(req.url).searchParams.get("regenerate") === "1";

  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  const attendees = await db
    .select({ email: calendarEventAttendees.email, name: calendarEventAttendees.name })
    .from(calendarEventAttendees)
    .where(eq(calendarEventAttendees.eventId, eventId));

  // Return cached brief if fresh (< 6 hours), unless user asked to regenerate.
  if (!regenerate && event.aiBrief && event.briefGeneratedAt) {
    const ageMs = Date.now() - event.briefGeneratedAt.getTime();
    if (ageMs < 6 * 3600 * 1000) {
      return NextResponse.json({
        brief: event.aiBrief,
        previousBrief: event.previousAiBrief ?? null,
        canRegenerate: !event.previousAiBrief,
        cached: true,
      });
    }
  }

  // At most two versions per event: original + one regeneration.
  if (regenerate && event.previousAiBrief) {
    return NextResponse.json({
      brief: event.aiBrief,
      previousBrief: event.previousAiBrief,
      canRegenerate: false,
      cached: true,
      message: "Maximum brief versions reached",
    });
  }

  try {
    await enforceAiQuota(userId, "brief");
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(e.toJSON(), {
        status: 429,
        headers: { "Retry-After": String(e.retryAfterSeconds) },
      });
    }
    throw e;
  }

  // Gather attendee emails (excluding self).
  const attendeeEmails = attendees
    .map((a) => a.email)
    .filter((e): e is string => !!e && e !== session.user!.email);

  // Fetch recent emails related to attendees (last 10).
  let emailContext = "";
  if (attendeeEmails.length) {
    const recentEmails = await db
      .select({ subject: emails.subject, fromEmail: emails.fromEmail, bodySnippet: emails.bodySnippet, receivedAt: emails.receivedAt })
      .from(emails)
      .where(eq(emails.userId, userId))
      .orderBy(desc(emails.receivedAt))
      .limit(30);

    const relevant = recentEmails.filter(
      (e) => e.fromEmail && attendeeEmails.some((a) => e.fromEmail!.includes(a))
    ).slice(0, 8);

    emailContext = relevant
      .map((e) => `From: ${e.fromEmail}\nSubject: ${e.subject ?? "(no subject)"}\nSnippet: ${e.bodySnippet ?? ""}`)
      .join("\n\n---\n\n");
  }

  const prompt = `You are preparing a pre-meeting brief for the following event.

Event: ${event.title ?? "Meeting"}
Time: ${event.startTime?.toISOString() ?? "unknown"}
Attendees: ${attendeeEmails.join(", ") || "none"}
Description: ${event.description ?? "none"}

${emailContext ? `Recent email context with attendees:\n${emailContext}` : "No recent email context available."}

Write a concise pre-meeting brief (3-5 bullet points) covering:
- Purpose / agenda of the meeting
- Key context from recent emails with attendees
- Any action items or decisions needed
- Suggested talking points

Keep it under 200 words. Plain text only — no markdown, no asterisks, no bold. Use • for top-level bullets and indent sub-points with a single leading space.`;

  // Build a fallback brief from whatever data we have, so the feature never
  // fails flat even when the model is unavailable or returns nothing.
  const fallbackBrief = [
    `• ${event.title ?? "Meeting"}${event.startTime ? ` — ${event.startTime.toISOString()}` : ""}`,
    attendeeEmails.length ? `• Attendees: ${attendeeEmails.join(", ")}` : "• No attendees listed",
    event.description ? `• Notes: ${event.description.slice(0, 200)}` : null,
    emailContext ? "• Recent email context with attendees is available." : "• No recent email context found.",
    "• AI summary unavailable right now — showing event details only.",
  ]
    .filter(Boolean)
    .join("\n");

  let brief = "";
  let degraded = false;
  try {
    brief = (await generateText(prompt)).trim();
  } catch {
    degraded = true;
  }
  if (!brief) {
    brief = fallbackBrief;
    degraded = true;
  }

  // Only cache successful AI briefs (don't persist the degraded fallback).
  if (!degraded) {
    await db
      .update(calendarEvents)
      .set({
        aiBrief: brief,
        previousAiBrief: regenerate && event.aiBrief ? event.aiBrief : event.previousAiBrief,
        briefGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, eventId));
  }

  const previousBrief =
    regenerate && event.aiBrief && !degraded ? event.aiBrief : event.previousAiBrief ?? null;

  return NextResponse.json({
    brief,
    previousBrief,
    canRegenerate: !previousBrief,
    cached: false,
    degraded,
  });
}
