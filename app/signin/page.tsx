"use client";

import { useState } from "react";
import {
  GoogleAuthProvider,
  sendSignInLinkToEmail,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { isAllowed } from "@/lib/allowlist";

const EMAIL_STORAGE_KEY = "emailForSignIn";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function handleGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      const email = result.user.email;
      if (!isAllowed(email)) {
        await signOut(auth);
        setStatus("error");
        setError("This Google account isn't set up for babylog.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("popup-closed")) {
        // User dismissed the popup — no need to surface an error.
      } else {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Google sign-in failed.",
        );
      }
    } finally {
      setGoogleBusy(false);
    }
  }

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
          <div className="w-full flex flex-col gap-4">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleBusy}
              className="w-full rounded-2xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-3"
            >
              <GoogleMark />
              {googleBusy ? "Signing in…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted">
              <span className="flex-1 h-px bg-accent-soft" />
              or email a link
              <span className="flex-1 h-px bg-accent-soft" />
            </div>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
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
                className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-sm font-semibold text-foreground transition active:scale-[0.99] disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Email sign-in link"}
              </button>
            </form>

            {error && (
              <p className="text-sm text-rose-600 text-center">{error}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#ffffff"
        d="M21.6 12.23c0-.64-.06-1.25-.17-1.84H12v3.49h5.4a4.62 4.62 0 0 1-2 3.03v2.52h3.23c1.89-1.74 2.97-4.3 2.97-7.2z"
      />
      <path
        fill="#ffffff"
        d="M12 22c2.7 0 4.96-.9 6.63-2.42l-3.23-2.52c-.9.6-2.05.96-3.4.96-2.61 0-4.83-1.76-5.62-4.13H3.04v2.6A10 10 0 0 0 12 22z"
        opacity="0.9"
      />
      <path
        fill="#ffffff"
        d="M6.38 13.9A6 6 0 0 1 6.06 12c0-.66.12-1.3.32-1.9V7.5H3.04a10 10 0 0 0 0 9l3.34-2.6z"
        opacity="0.78"
      />
      <path
        fill="#ffffff"
        d="M12 6.04c1.47 0 2.8.51 3.85 1.51l2.87-2.87A10 10 0 0 0 3.04 7.5l3.34 2.6C7.17 7.73 9.39 5.96 12 5.96z"
        opacity="0.65"
      />
    </svg>
  );
}
