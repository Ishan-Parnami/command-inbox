import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { CorsairAuthError } from "@/lib/corsair/client";
import { syncGmail } from "@/lib/sync/gmail";
import { classifyUnclassified } from "@/lib/llm/classify";
import { broadcastToUser } from "@/lib/sse";

// Real-time fallback: the client hits this on an interval. Pulls the few newest
// messages; if any are new, classifies them and pushes an SSE event so every
// open tab refreshes. Used until/unless Corsair webhook delivery is wired.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  try {
    const { created } = await syncGmail(userId, 10);
    if (created > 0) {
      await classifyUnclassified(userId, created);
      broadcastToUser(userId, { type: "gmail.message.received", count: created });
    }
    return NextResponse.json({ created });
  } catch (e) {
    if (e instanceof CorsairAuthError) {
      return NextResponse.json({ error: "reconnect", signInLink: e.signInLink }, { status: 409 });
    }
    // Transient DB/network blips (e.g. Neon "fetch failed") shouldn't surface as
    // a 500 on a background poll — report zero new items and let the next tick retry.
    console.error("[poll] transient error:", e);
    return NextResponse.json({ created: 0 });
  }
}
