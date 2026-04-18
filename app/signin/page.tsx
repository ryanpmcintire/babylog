"use client";

import { useState } from "react";
import { sendSignInLinkToEmail } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { isAllowed } from "@/lib/allowlist";

const EMAIL_STORAGE_KEY = "emailForSignIn";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    if (!isAllowed(normalized)) {
      setStatus("error");
      setError("This email isn't set up for babylog yet.");
      return;
    }

    setStatus("sending");
    setError(null);

    try {
      await sendSignInLinkToEmail(getFirebaseAuth(), normalized, {
        url: `${window.location.origin}/auth/callback`,
        handleCodeInApp: true,
      });
      try {
        window.localStorage.setItem(EMAIL_STORAGE_KEY, normalized);
      } catch {
        // Private mode — the callback page will prompt for email instead.
      }
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted">
            Babylog
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Sign in
          </h1>
          <p className="text-sm text-muted">
            We&rsquo;ll email you a one-tap sign-in link.
          </p>
        </div>

        {status === "sent" ? (
          <div className="w-full rounded-2xl border border-accent-soft bg-surface p-5 shadow-sm">
            <p className="text-base text-foreground">
              Check your email for a sign-in link.
            </p>
            <p className="mt-2 text-xs text-muted">
              You can close this tab — the link will bring you back.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-2xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {error && (
              <p className="text-sm text-rose-600 text-center">{error}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
