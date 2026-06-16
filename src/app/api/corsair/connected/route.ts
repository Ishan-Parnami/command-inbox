import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import {
  listMessages,
  listEvents,
  CorsairAuthError,
  type Provider,
} from "@/lib/corsair/client";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar } from "@/lib/sync/calendar";

async function recordConnection(userId: string, provider: Provider, email?: string | null) {
  await db
    .insert(corsairConnections)
    .values({ userId, provider, connectedEmail: email ?? null, status: "connected" })
    .onConflictDoUpdate({
      target: [corsairConnections.userId, corsairConnections.provider],
      set: { status: "connected", connectedEmail: email ?? null, updatedAt: new Date() },
    });
}

// Return URL after the Corsair OAuth flow. Verifies the provider is actually
// reachable, records the connection, then sends the user back to the inbox.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  const userId = session.user.id;

  const provider = new URL(req.url).searchParams.get("provider") as Provider | null;
  if (provider !== "gmail" && provider !== "googlecalendar") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Idempotent: if this provider is already connected, don't re-run the OAuth
  // probe — otherwise a Back-navigation here would bounce through Corsair OAuth
  // and dump the user on Google's account picker.
  const [existing] = await db
    .select({ id: corsairConnections.id })
    .from(corsairConnections)
    .where(and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, provider)));
  if (existing) return NextResponse.redirect(new URL("/", req.url));

  // Confirm the token works with a 1-item probe.
  try {
    if (provider === "gmail") await listMessages(userId, { maxResults: 1 });
    else await listEvents(userId, { maxResults: 1 });
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      // No token at all — user cancelled the OAuth flow.
      return NextResponse.redirect(new URL(`/?connect_error=${provider}`, req.url));
    }
    // OAuth completed but the probe failed — usually insufficient scopes granted
    // (e.g. only "send" was checked). Record the connection anyway and flag it so
    // the UI can ask the user to reconnect with full permissions.
    console.error(`[corsair] ${provider} probe failed:`, e);
    await recordConnection(userId, provider, session.user.email);
    return NextResponse.redirect(new URL(`/?scope_error=${provider}`, req.url));
  }

  await recordConnection(userId, provider, session.user.email);

  // Backfill the local mirror immediately so data is visible without manual Sync.
  try {
    if (provider === "gmail") await syncGmail(userId, 30);
    else await syncCalendar(userId, session.user.email);
  } catch (e) {
    console.error(`[corsair] ${provider} initial sync failed:`, e);
  }

  return NextResponse.redirect(new URL(`/?connected=${provider}`, req.url));
}
