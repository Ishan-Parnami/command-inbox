import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { syncGmail } from "@/lib/sync/gmail";
import { classifyUnclassified } from "@/lib/llm/classify";
import { broadcastToUser } from "@/lib/sse";
import { CorsairAuthError } from "@/lib/corsair/client";

// Real-time fallback: the client hits this on an interval. Pulls the few newest
// messages; if any are new, classifies them and pushes an SSE event so every
// open tab refreshes. Used until/unless Corsair webhook delivery is wired.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const conns = await db
    .select()
    .from(corsairConnections)
    .where(eq(corsairConnections.userId, userId));
  if (!conns.some((c) => c.provider === "gmail")) return NextResponse.json({ created: 0 });

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
    throw e;
  }
}
