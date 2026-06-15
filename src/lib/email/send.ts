import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { corsairConnections } from "@/lib/db/schema";
import { sendMessage } from "@/lib/corsair/client";
import { buildRawMessage } from "@/lib/email/mime";

/** The connected Gmail address, used as the `From` header. */
export async function gmailAddress(userId: string): Promise<string | null> {
  const [conn] = await db
    .select({ email: corsairConnections.connectedEmail })
    .from(corsairConnections)
    .where(and(eq(corsairConnections.userId, userId), eq(corsairConnections.provider, "gmail")));
  return conn?.email ?? null;
}

export type SendInput = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  gmailThreadId?: string;
};

/** Build the RFC-2822 message and hand it to Gmail via Corsair. */
export async function sendEmail(userId: string, input: SendInput) {
  const from = await gmailAddress(userId);
  const raw = buildRawMessage({
    from,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    body: input.body,
  });
  return sendMessage(userId, raw, input.gmailThreadId);
}
