import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, emails } from "@/lib/db/schema";

/** Count mirrored emails received from each sender address (case-insensitive). */
export async function contactEmailCounts(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      fromEmail: sql<string>`lower(${emails.fromEmail})`,
      count: sql<number>`count(*)::int`,
    })
    .from(emails)
    .where(and(eq(emails.userId, userId), isNotNull(emails.fromEmail)))
    .groupBy(sql`lower(${emails.fromEmail})`);

  return new Map(rows.map((r) => [r.fromEmail, r.count]));
}

/**
 * Build a name → email directory string for the user's saved contacts so the
 * LLM (parse + agent) can resolve a spoken name like "John" to a real email.
 * VIPs and frequently-emailed named contacts come first. Returns "" if none.
 */
export async function contactDirectory(userId: string, limit = 60): Promise<string> {
  try {
    const counts = await contactEmailCounts(userId);
    const rows = await db
      .select({ name: contacts.name, email: contacts.email, isVip: contacts.isVip })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), isNotNull(contacts.name)));

    rows.sort((a, b) => {
      const vip = Number(b.isVip) - Number(a.isVip);
      if (vip !== 0) return vip;
      return (counts.get(b.email.toLowerCase()) ?? 0) - (counts.get(a.email.toLowerCase()) ?? 0);
    });

    const top = rows.slice(0, limit);
    if (!top.length) return "";
    return top.map((r) => `${r.name} <${r.email}>${r.isVip ? " (VIP)" : ""}`).join("\n");
  } catch {
    return "";
  }
}
