"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { isAllowed } from "@/lib/allowlist";

const EMAIL_STORAGE_KEY = "emailForSignIn";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"working" | "needsEmail" | "error">(
    "working",
  );
  const [promptEmail, setPromptEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const href = window.location.href;
    if (!isSignInWithEmailLink(auth, href)) {
      setStatus("error");
      setError("This link isn't valid. Request a new sign-in link.");
      return;
    }

    let storedEmail: string | null = null;
    try {
      storedEmail = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    } catch {
      /* ignore */
    }

    if (!storedEmail) {
      setStatus("needsEmail");
      return;
    }

    completeSignIn(storedEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function completeSignIn(emailToUse: string) {
    const normalized = emailToUse.trim().toLowerCase();
    if (!isAllowed(normalized)) {
      setStatus("error");
      setError("This email isn't set up for babylog.");
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timed out after 15s waiting for Firebase.")),
        15000,
      ),
    );

    try {
      await Promise.race([
        signInWithEmailLink(
          getFirebaseAuth(),
          normalized,
          window.location.href,
        ),
        timeout,
      ]);
      try {
        window.localStorage.removeItem(EMAIL_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.replace("/");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Sign-in failed. Try again.",
      );
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-6">
        {status === "working" && (
          <p className="text-base text-muted">Signing you in…</p>
        )}

        {status === "needsEmail" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              completeSignIn(promptEmail);
            }}
            className="w-full flex flex-col gap-4"
          >
            <h1 className="text-xl font-semibold text-foreground">
              Confirm your email
            </h1>
            <p className="text-sm text-muted">
              This looks like a new device. Enter the email you used to request
              the link.
            </p>
            <input
              type="email"
              inputMode="email"
              required
              placeholder="your@email.com"
              value={promptEmail}
              onChange={(e) => setPromptEmail(e.target.value)}
              className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="w-full rounded-2xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm active:scale-[0.99]"
            >
              Sign in
            </button>
          </form>
        )}

        {status === "error" && (
          <div className="w-full flex flex-col gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              Sign-in failed
            </h1>
            <p className="text-sm text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => router.replace("/signin")}
              className="self-center mt-2 rounded-2xl border border-accent-soft px-4 py-2 text-sm text-foreground"
            >
              Back to sign-in
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
