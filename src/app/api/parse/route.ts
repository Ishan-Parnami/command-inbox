import { NextResponse } from "next/server";
import { Type, type Schema } from "@google/genai";
import { auth } from "@/auth";
import { generateJSON, MODELS } from "@/lib/gemini/client";
import { contactDirectory } from "@/lib/contacts";

export const dynamic = "force-dynamic";

const PARSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, description: "'email' or 'event'" },
    email: {
      type: Type.OBJECT,
      properties: {
        to: { type: Type.STRING, description: "Recipient email or name" },
        subject: { type: Type.STRING },
        body: { type: Type.STRING },
      },
    },
    event: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        startTime: { type: Type.STRING, description: "ISO 8601 datetime" },
        endTime: { type: Type.STRING, description: "ISO 8601 datetime" },
        attendees: { type: Type.STRING, description: "Comma-separated emails" },
      },
    },
  },
  required: ["intent"],
};

type ParseResult = {
  intent: "email" | "event";
  email?: { to?: string; subject?: string; body?: string };
  event?: {
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    attendees?: string;
  };
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim())
    return NextResponse.json({ error: "text required" }, { status: 400 });

  console.log("[parse] input:", text.trim());

  const now = new Date();
  const directory = await contactDirectory(session.user.id);
  console.log("[parse] contact directory:", directory ? `${directory.split("\n").length} contacts` : "none");
  const system = `You convert a single natural-language instruction into structured JSON for an email/calendar app.
Today is ${now.toISOString()} (${now.toString()}).
- Decide intent: "email" to draft/send a message, "event" to schedule a calendar event.
- For events, resolve relative times (e.g. "tomorrow 3pm", "next Monday") against today and output ISO 8601. If no end time is given, default to 1 hour after start.
- For emails, write a concise subject and a short polite body. Put the recipient in "to".
${directory ? `- Known contacts (resolve any person's name mentioned to their email; use the email in "to"/attendees):\n${directory}` : "- If a name has no known email, put the raw name in the field."}
Return JSON only.`;

  try {
    const result = await generateJSON<ParseResult>(text, {
      model: MODELS.agent,
      system,
      schema: PARSE_SCHEMA,
    });
    console.log("[parse] result:", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    console.error("[parse] failed:", e instanceof Error ? { message: e.message, stack: e.stack } : e);
    return NextResponse.json({ error: "parse_failed" }, { status: 502 });
  }
}
