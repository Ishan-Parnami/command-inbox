"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function GoogleSignInButton() {
  return (
    <Button size="lg" className="w-full" onClick={() => signIn("google", { callbackUrl: "/" })}>
      Continue with Google
    </Button>
  );
}
