import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConversations } from "@/lib/db/schema";

// Lists the user's past AI conversations (metadata only) for the history panel.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select({
        id: agentConversations.id,
        messages: agentConversations.messages,
        updatedAt: agentConversations.updatedAt,
      })
      .from(agentConversations)
      .where(eq(agentConversations.userId, session.user.id))
      .orderBy(desc(agentConversations.updatedAt))
      .limit(50);

    const conversations = rows
      .map((r) => {
        const msgs = (r.messages ?? []) as Array<{ role: string; content: unknown }>;
        const firstUser = msgs.find((m) => m.role === "user");
        const title =
          typeof firstUser?.content === "string" && firstUser.content.trim()
            ? firstUser.content.trim().slice(0, 80)
            : "Untitled conversation";
        return { id: r.id, title, count: msgs.length, updatedAt: r.updatedAt };
      })
      .filter((c) => c.count > 0);

    return NextResponse.json({ conversations });
  } catch {
    return NextResponse.json({ conversations: [] });
  }
}
