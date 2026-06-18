import { NextResponse } from "next/server";
import { decodeOAuthState } from "corsair/oauth";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections, users } from "@/lib/db/schema";
import { completeOAuth, hasRequiredScopes, verifyProviderAuth, type Provider } from "@/lib/corsair/client";
import { syncGmail } from "@/lib/sync/gmail";
import { syncCalendar } from "@/lib/sync/calendar";

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function scopeErrorRedirect(req: Request, provider: Provider) {
  return NextResponse.redirect(new URL(`/?scope_error=${provider}`, req.url));
}

function parseOAuthState(state: string | null) {
  if (!state) return null;
  return decodeOAuthState(state, { maxAgeMs: OAUTH_STATE_MAX_AGE_MS });
}

// Google redirects here after the user authorizes. We exchange the code for
// tokens (stored per tenant by Corsair), record the connection, and kick off an
// initial backfill so data is visible without a manual sync.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const grantedScope = url.searchParams.get("scope");
  const oauthState = parseOAuthState(state);

  // User denied consent or closed the Google screen.
  if (oauthError === "access_denied") {
    if (oauthState?.plugin === "gmail" || oauthState?.plugin === "googlecalendar") {
      return scopeErrorRedirect(req, oauthState.plugin);
    }
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

  if (!code || !state || !oauthState) {
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

  const { plugin, tenantId: userId } = oauthState;
  if (plugin !== "gmail" && plugin !== "googlecalendar") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const provider = plugin as Provider;

  // Google may return a code even when the user unchecked some requested scopes.
  if (!hasRequiredScopes(grantedScope, provider)) {
    return scopeErrorRedirect(req, provider);
  }

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=session", req.url));
  }
  const email = user.email;

  try {
    await completeOAuth(code, state);
  } catch (e) {
    console.error("[corsair] OAuth callback failed:", e);
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

  if (!(await verifyProviderAuth(userId, provider))) {
    return scopeErrorRedirect(req, provider);
  }

  try {
    await db
      .insert(corsairConnections)
      .values({ userId, provider, connectedEmail: email, status: "connected" })
      .onConflictDoUpdate({
        target: [corsairConnections.userId, corsairConnections.provider],
        set: { status: "connected", connectedEmail: email, updatedAt: new Date() },
      });
  } catch (e) {
    console.error("[corsair] Failed to record connection:", e);
    return NextResponse.redirect(new URL("/?connect_error=1", req.url));
  }

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
