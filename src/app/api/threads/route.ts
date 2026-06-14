import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInboxThreads } from "@/lib/inbox";

// Inbox thread list — refetched by the client when SSE signals a change.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ threads: await getInboxThreads(session.user.id) });
}
