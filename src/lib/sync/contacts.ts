import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

type EmailSender = {
  email: string;
  name: string | null;
  receivedAt: Date | null;
};

export async function upsertContacts(userId: string, senders: EmailSender[]) {
  if (!senders.length) return;

  for (const s of senders) {
    if (!s.email) continue;
    await db
      .insert(contacts)
      .values({
        userId,
        email: s.email,
        name: s.name ?? null,
        emailCount: 1,
        lastEmailedAt: s.receivedAt ?? undefined,
        firstSeenAt: s.receivedAt ?? undefined,
      })
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.email],
        set: {
          emailCount: sql`${contacts.emailCount} + 1`,
          lastEmailedAt: sql`GREATEST(${contacts.lastEmailedAt}, ${s.receivedAt?.toISOString() ?? null})`,
          name: sql`COALESCE(EXCLUDED.name, ${contacts.name})`,
        },
      })
      .catch(() => {});
  }
}
