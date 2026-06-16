import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

/**
 * Build a name → email directory string for the user's saved contacts so the
 * LLM (parse + agent) can resolve a spoken name like "John" to a real email.
 * VIPs and frequently-emailed named contacts come first. Returns "" if none.
 */
export async function contactDirectory(userId: string, limit = 60): Promise<string> {
  try {
    const rows = await db
      .select({ name: contacts.name, email: contacts.email, isVip: contacts.isVip })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), isNotNull(contacts.name)))
      .orderBy(desc(contacts.isVip), desc(contacts.emailCount))
      .limit(limit);
    if (!rows.length) return "";
    return rows.map((r) => `${r.name} <${r.email}>${r.isVip ? " (VIP)" : ""}`).join("\n");
  } catch {
    return "";
  }
}
