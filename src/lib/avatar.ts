import "server-only";

const AVATAR_SIZE = 96;
const MAX_BYTES = 200_000;

/** Google profile photo URLs support =s{N} — keep small to reduce CDN load. */
export function normalizeGoogleAvatarUrl(url: string): string {
  if (!url.includes("googleusercontent.com")) return url;
  if (/=s\d+/.test(url)) return url.replace(/=s\d+(-c)?/g, `=s${AVATAR_SIZE}`);
  return `${url}=s${AVATAR_SIZE}`;
}

export function avatarProxyPath(userId: string): string {
  return `/api/avatar/${userId}`;
}

export function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], body: Buffer.from(match[2], "base64") };
}

/** Fetch a remote avatar and store as a data URL in the DB. */
export async function fetchAvatarAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * On OAuth sign-in: normalize Google URLs to s96, download once, persist as data URL.
 * Falls back to the normalized remote URL if the download fails.
 */
export async function resolveAvatarForStorage(
  sourceUrl: string | null | undefined
): Promise<string | null> {
  if (!sourceUrl) return null;
  const normalized = normalizeGoogleAvatarUrl(sourceUrl);
  if (normalized.includes("googleusercontent.com")) {
    return (await fetchAvatarAsDataUrl(normalized)) ?? normalized;
  }
  return normalized;
}

export const AVATAR_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
