import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAuthUrl, type Provider } from "@/lib/corsair/client";

// Kicks off the Google OAuth flow for a provider. Google sends the user back to
// /api/corsair/callback (with code+state), which stores the tokens.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));

  const provider = new URL(req.url).searchParams.get("provider") as Provider | null;
  if (provider !== "gmail" && provider !== "googlecalendar") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const url = await getAuthUrl(session.user.id, provider, session.user.email ?? undefined);
  return NextResponse.redirect(url);
}
