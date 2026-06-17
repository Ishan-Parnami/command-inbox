import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections, users } from "@/lib/db/schema";
import { completeOAuth, type Provider } from "@/lib/corsair/client";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar } from "@/lib/sync/calendar";

// Google redirects here after the user authorizes. We exchange the code for
// tokens (stored per tenant by Corsair), record the connection, and kick off an
// initial backfill so data is visible without a manual sync.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // User cancelled or Google returned an error.
  if (!code || !state) {
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

  let plugin: string;
  let userId: string;
  try {
    ({ plugin, tenantId: userId } = await completeOAuth(code, state));
  } catch (e) {
    console.error("[corsair] OAuth callback failed:", e);
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

  if (plugin !== "gmail" && plugin !== "googlecalendar") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const provider = plugin as Provider;

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  const email = user?.email ?? null;

  await db
    .insert(corsairConnections)
    .values({ userId, provider, connectedEmail: email, status: "connected" })
    .onConflictDoUpdate({
      target: [corsairConnections.userId, corsairConnections.provider],
      set: { status: "connected", connectedEmail: email, updatedAt: new Date() },
    });

  // Backfill the local mirror immediately so data shows up without manual Sync.
  try {
    if (provider === "gmail") await syncGmail(userId, 30);
    else await syncCalendar(userId, email);
  } catch (e) {
    console.error(`[corsair] ${provider} initial sync failed:`, e);
  }

  // One "Connect Google" action: after Gmail, chain straight into the Calendar
  // consent if it isn't connected yet (each provider is a separate OAuth flow).
  if (provider === "gmail") {
    const [cal] = await db
      .select({ userId: corsairConnections.userId })
      .from(corsairConnections)
      .where(
        and(
          eq(corsairConnections.userId, userId),
          eq(corsairConnections.provider, "googlecalendar")
        )
      );
    if (!cal) {
      return NextResponse.redirect(new URL("/api/corsair/connect?provider=googlecalendar", req.url));
    }
  }

  return NextResponse.redirect(new URL(`/?connected=${provider}`, req.url));
}
