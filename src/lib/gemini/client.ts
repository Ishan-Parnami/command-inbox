import "server-only";
import { GoogleGenAI, type Schema } from "@google/genai";

// ── Gemini client (singleton) ─────────────────────────────────────────────────
// One key (GEMINI_API_KEY from Google AI Studio) drives both chat + embeddings.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Model roles — central place to swap tiers. Flash-Lite is the cheap, high-volume
// workhorse for per-email classification; Flash handles agent/brief/compose.
export const MODELS = {
  classify: "gemini-2.5-flash-lite",
  agent: "gemini-2.5-flash",
  brief: "gemini-2.5-flash",
  embed: "gemini-embedding-001",
} as const;

// Must stay in sync with vector(1024) in db/schema.ts and drizzle/hnsw.sql.
export const EMBED_DIMS = 1024;

// ── Embeddings ─────────────────────────────────────────────────────────────────
// Email bodies are documents; search queries use RETRIEVAL_QUERY for asymmetric
// retrieval. The HNSW index is cosine, so the non-3072 (unnormalized) output is fine.
type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embed(content: string, taskType: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: MODELS.embed,
    contents: content,
    config: { taskType, outputDimensionality: EMBED_DIMS },
  });
  return res.embeddings![0].values!;
}

export async function embedBatch(contents: string[], taskType: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: MODELS.embed,
    contents,
    config: { taskType, outputDimensionality: EMBED_DIMS },
  });
  return res.embeddings!.map((e) => e.values!);
}

// ── Text generation ─────────────────────────────────────────────────────────────
type GenOpts = { model?: string; system?: string; temperature?: number };

/** Free-form text — pre-meeting briefs, compose assist. Defaults to Flash. */
export async function generateText(prompt: string, opts: GenOpts = {}): Promise<string> {
  const res = await ai.models.generateContent({
    model: opts.model ?? MODELS.brief,
    contents: prompt,
    config: { systemInstruction: opts.system, temperature: opts.temperature },
  });
  return res.text ?? "";
}

/**
 * Structured JSON — email classification. Pass `schema` to constrain the shape.
 * Defaults to Flash-Lite at temperature 0 for deterministic, cheap output.
 */
export async function generateJSON<T>(
  prompt: string,
  opts: GenOpts & { schema?: Schema } = {}
): Promise<T> {
  const res = await ai.models.generateContent({
    model: opts.model ?? MODELS.classify,
    contents: prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
    },
  });
  return JSON.parse(res.text ?? "{}") as T;
}

/** Streaming text chunks — agent chat. Defaults to Flash. */
export async function* streamText(prompt: string, opts: GenOpts = {}): AsyncGenerator<string> {
  const stream = await ai.models.generateContentStream({
    model: opts.model ?? MODELS.agent,
    contents: prompt,
    config: { systemInstruction: opts.system, temperature: opts.temperature },
  });
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}
