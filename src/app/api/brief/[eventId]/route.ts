import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { calendarEvents, emails } from "@/lib/db/schema";
import { generateText } from "@/lib/gemini/client";

export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { eventId } = await params;

  const event = await db.query.calendarEvents.findFirst({
    where: and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)),
    with: { attendees: true },
  });
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Return cached brief if fresh (< 6 hours).
  if (event.aiBrief && event.briefGeneratedAt) {
    const ageMs = Date.now() - event.briefGeneratedAt.getTime();
    if (ageMs < 6 * 3600 * 1000) return NextResponse.json({ brief: event.aiBrief, cached: true });
  }

  // Gather attendee emails (excluding self).
  const attendeeEmails = (event.attendees ?? [])
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

Keep it under 200 words. Plain text, use • bullets.`;

  const brief = await generateText(prompt);

  // Cache in DB.
  await db
    .update(calendarEvents)
    .set({ aiBrief: brief, briefGeneratedAt: new Date(), updatedAt: new Date() })
    .where(eq(calendarEvents.id, eventId));

  return NextResponse.json({ brief, cached: false });
}
