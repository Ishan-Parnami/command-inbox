import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeUrl, type Provider } from "@/lib/corsair/client";

// Kicks off the Corsair-hosted OAuth flow for a provider. Corsair sends the user
// back to /api/corsair/connected once they authorize.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));

  const provider = new URL(req.url).searchParams.get("provider") as Provider | null;
  if (provider !== "gmail" && provider !== "googlecalendar") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const returnTo = new URL(`/api/corsair/connected?provider=${provider}`, req.url).toString();
  const url = await authorizeUrl(session.user.id, provider, returnTo);
  return NextResponse.redirect(url);
}
