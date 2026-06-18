"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/shared/GoogleSignInButton";
import { cn } from "@/lib/utils";

export function LoginForm() {
  const [emailLoading, setEmailLoading] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-5 space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Email sign-in</h2>
        </div>
        <EmailSignInForm onLoadingChange={setEmailLoading} />
      </div>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wide">
          <span className="bg-background px-3 text-muted-foreground">or</span>
        </div>
      </div>
      <GoogleSignInButton disabled={emailLoading} />
    </div>
  );
}

/** Email/password login for users who have set a password on their account. */
function EmailSignInForm({ onLoadingChange }: { onLoadingChange?: (loading: boolean) => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setLoadingState = (next: boolean) => {
    setLoading(next);
    onLoadingChange?.(next);
  };

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const clearError = () => {
    if (error) setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    flushSync(() => {
      setError(null);
      setLoadingState(true);
    });
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Invalid email or password.");
        setLoadingState(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoadingState(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className={cn("space-y-4", loading && "pointer-events-none")}
      noValidate
      aria-busy={loading}
    >
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-sm font-medium">
          Email
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError();
            }}
            placeholder="you@example.com"
            required
            disabled={loading}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            placeholder="Enter your password"
            required
            disabled={loading}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
            className="h-9 pr-9"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            disabled={loading}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div
          id="login-error"
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          )}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="h-10 w-full"
        disabled={loading || !canSubmit}
        aria-disabled={loading || !canSubmit}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>Signing in…</span>
          </>
        ) : (
          <>
            <LogIn className="size-4" aria-hidden />
            <span>Sign in</span>
          </>
        )}
      </Button>
    </form>
  );
}
