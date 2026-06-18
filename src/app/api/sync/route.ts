import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar } from "@/lib/sync/calendar";
import { classifyUnclassified } from "@/lib/llm/classify";
import { CorsairAuthError, hasCorsairAccount } from "@/lib/corsair/client";

// Pulls recent Gmail + Calendar data into the local mirror for whichever
// providers the user has connected.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const conns = await db
    .select()
    .from(corsairConnections)
    .where(eq(corsairConnections.userId, userId));

  const result: { emails?: number; events?: number; classified?: number } = {};
  const gmail = await hasCorsairAccount(userId, "gmail");
  const cal = (await hasCorsairAccount(userId, "googlecalendar"))
    ? conns.find((c) => c.provider === "googlecalendar")
    : undefined;
  try {
    const [gmailResult, eventCount] = await Promise.all([
      gmail ? syncGmail(userId) : Promise.resolve(null),
      cal ? syncCalendar(userId, cal.connectedEmail) : Promise.resolve(null),
    ]);
    if (gmailResult) result.emails = gmailResult.processed;
    if (eventCount !== null) result.events = eventCount;
    // Classification is the slowest step — run after mail is mirrored, don't block calendar.
    if (gmail) result.classified = await classifyUnclassified(userId);
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true, ...result });
}
