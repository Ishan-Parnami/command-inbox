import "server-only";
import { GoogleGenAI, type Schema } from "@google/genai";

export const MODELS = {
  classify: "gemini-2.5-flash-lite",
  agent: "gemini-2.5-flash",
  brief: "gemini-2.5-flash",
  embed: "gemini-embedding-001",
} as const;

export const EMBED_DIMS = 1024;

type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
type GenOpts = { model?: string; system?: string; temperature?: number };

function getApiKeys(): string[] {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_FALLBACK_1,
    process.env.GEMINI_API_KEY_FALLBACK_2,
  ].filter((k): k is string => !!k?.trim());
  if (!keys.length) throw new Error("No GEMINI_API_KEY configured");
  return keys;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function errorStatus(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return undefined;
}

/** Rotate to next key on provider rate limits / transient failures. */
export function isRetryableGeminiError(e: unknown): boolean {
  const status = errorStatus(e);
  if (status === 429 || status === 503 || status === 502) return true;
  const msg = errorMessage(e).toLowerCase();
  return /quota|rate.?limit|resource.?exhausted|too many requests|overloaded|unavailable/.test(msg);
}

export async function withGeminiRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const keys = getApiKeys();
  let lastError: unknown;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await fn(new GoogleGenAI({ apiKey: keys[i] }));
    } catch (e) {
      lastError = e;
      const hasNext = i < keys.length - 1;
      if (!hasNext || !isRetryableGeminiError(e)) throw e;
      console.warn(`[gemini] key ${i + 1}/${keys.length} failed, trying next:`, errorMessage(e));
    }
  }
  throw lastError;
}

export async function embed(content: string, taskType: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
  const res = await withGeminiRetry((ai) =>
    ai.models.embedContent({
      model: MODELS.embed,
      contents: content,
      config: { taskType, outputDimensionality: EMBED_DIMS },
    })
  );
  return res.embeddings![0].values!;
}

export async function embedBatch(contents: string[], taskType: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  const res = await withGeminiRetry((ai) =>
    ai.models.embedContent({
      model: MODELS.embed,
      contents,
      config: { taskType, outputDimensionality: EMBED_DIMS },
    })
  );
  return res.embeddings!.map((e) => e.values!);
}

export async function generateText(prompt: string, opts: GenOpts = {}): Promise<string> {
  const res = await withGeminiRetry((ai) =>
    ai.models.generateContent({
      model: opts.model ?? MODELS.brief,
      contents: prompt,
      config: { systemInstruction: opts.system, temperature: opts.temperature },
    })
  );
  return res.text ?? "";
}

export async function generateJSON<T>(
  prompt: string,
  opts: GenOpts & { schema?: Schema } = {}
): Promise<T> {
  const res = await withGeminiRetry((ai) =>
    ai.models.generateContent({
      model: opts.model ?? MODELS.classify,
      contents: prompt,
      config: {
        systemInstruction: opts.system,
        temperature: opts.temperature ?? 0,
        responseMimeType: "application/json",
        responseSchema: opts.schema,
      },
    })
  );
  return JSON.parse(res.text ?? "{}") as T;
}

export async function* streamText(prompt: string, opts: GenOpts = {}): AsyncGenerator<string> {
  const stream = await withGeminiRetry((ai) =>
    ai.models.generateContentStream({
      model: opts.model ?? MODELS.agent,
      contents: prompt,
      config: { systemInstruction: opts.system, temperature: opts.temperature },
    })
  );
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}
