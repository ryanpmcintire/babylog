"use client";

import Link from "next/link";
import { LILY_BIRTHDATE, formatBabyAge } from "@/lib/age";
import { ALLOWED_EMAILS } from "@/lib/allowlist";
import { useAuth } from "../providers";

export default function SettingsPage() {
  const { user, signOut } = useAuth();

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            ← Home
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <span className="w-12" />
        </div>

        <Section title="Baby">
          <Row label="Name" value="Lily Patricia McIntire" />
          <Row
            label="Born"
            value={LILY_BIRTHDATE.toLocaleString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />
          <Row label="Age" value={formatBabyAge(LILY_BIRTHDATE)} />
        </Section>

        <Section title="Account">
          <Row label="Signed in as" value={user?.email ?? "—"} />
          <button
            type="button"
            onClick={() => signOut()}
            className="self-start text-sm text-rose-600 underline decoration-dotted underline-offset-4"
          >
            Sign out
          </button>
        </Section>

        <Section title="Household">
          <p className="text-xs text-muted">
            These emails can sign in and log events:
          </p>
          <ul className="flex flex-col gap-1">
            {ALLOWED_EMAILS.map((e) => (
              <li key={e} className="text-sm text-foreground tabular-nums">
                {e}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="App">
          <Row label="Version" value="v1 · phase 5" />
          <p className="text-xs text-muted leading-relaxed">
            Events edit window is 24 hours from the time they happened. Only
            the person who logged an event can edit or delete it.
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="w-full rounded-3xl border border-accent-soft bg-surface p-5 shadow-sm flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm font-semibold text-foreground text-right">
        {value}
      </span>
    </div>
  );
}
