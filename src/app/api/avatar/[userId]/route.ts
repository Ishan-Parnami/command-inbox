import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  AVATAR_CACHE_CONTROL,
  fetchAvatarAsDataUrl,
  normalizeGoogleAvatarUrl,
  parseDataUrl,
} from "@/lib/avatar";

// Serves avatars from DB (data URL or lazy-migrated Google URL). Cached at the edge.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const [row] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId));

  if (!row?.avatarUrl) {
    return new Response(null, { status: 404 });
  }

  let avatarUrl = row.avatarUrl;

  // Legacy rows: still pointing at Google — fetch once, persist, then serve.
  if (avatarUrl.startsWith("http")) {
    const normalized = normalizeGoogleAvatarUrl(avatarUrl);
    const dataUrl = (await fetchAvatarAsDataUrl(normalized)) ?? null;
    if (dataUrl) {
      avatarUrl = dataUrl;
      await db
        .update(users)
        .set({ avatarUrl: dataUrl, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      const res = await fetch(normalized, { headers: { Accept: "image/*" } });
      if (!res.ok) return new Response(null, { status: 404 });
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const body = new Uint8Array(await res.arrayBuffer());
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": AVATAR_CACHE_CONTROL,
        },
      });
    }
  }

  const parsed = parseDataUrl(avatarUrl);
  if (!parsed) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(parsed.body), {
    headers: {
      "Content-Type": parsed.contentType,
      "Cache-Control": AVATAR_CACHE_CONTROL,
    },
  });
}
