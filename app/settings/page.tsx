"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBabyAge } from "@/lib/age";
import { useBaby } from "@/lib/baby";
import { ALLOWED_EMAILS } from "@/lib/allowlist";
import { fetchAllEvents, writeEvent } from "@/lib/useEvents";
import { useBoolPref } from "@/lib/prefs";
import { useAuth } from "../providers";
import { ThemeToggle } from "../components/ThemeToggle";
import type { BabyEvent } from "@/lib/events";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const baby = useBaby();
  const [showGrowthCurves, setShowGrowthCurves] = useBoolPref(
    "showGrowthCurves",
  );
  const [weightGrams, setWeightGrams] = useState("");
  const [weightLb, setWeightLb] = useState("");
  const [weightOz, setWeightOz] = useState("");
  const [measuredAt, setMeasuredAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [weightFlash, setWeightFlash] = useState<string | null>(null);
  const [weightBusy, setWeightBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportCsv() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const events = await fetchAllEvents();
      const csv = eventsToCsv(events);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `babylog-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Export failed",
      );
    } finally {
      setExportBusy(false);
    }
  }

  async function submitWeight() {
    if (weightBusy) return;
    const grams = weightGrams.trim()
      ? Number(weightGrams)
      : weightLb.trim() || weightOz.trim()
        ? Math.round(
            (Number(weightLb || 0) * 16 + Number(weightOz || 0)) *
              28.349523125,
          )
        : NaN;
    if (!Number.isFinite(grams) || grams <= 0) {
      setWeightFlash("Enter a weight in grams or lb/oz.");
      return;
    }
    setWeightBusy(true);
    try {
      const when = new Date(measuredAt);
      await writeEvent({ type: "weight", weight_grams: grams }, when);
      setWeightFlash(`Logged ${grams} g`);
      setWeightGrams("");
      setWeightLb("");
      setWeightOz("");
      setTimeout(() => setWeightFlash(null), 2500);
    } catch (err) {
      setWeightFlash(
        err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save",
      );
    } finally {
      setWeightBusy(false);
    }
  }

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
          <ThemeToggle />
        </div>

        <Section title="Baby">
          <Row label="Name" value={baby.fullName ?? baby.name} />
          <Row
            label="Born"
            value={baby.birthdate.toLocaleString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />
          <Row label="Age" value={formatBabyAge(baby.birthdate)} />
        </Section>

        <Section title="Log weight">
          <p className="text-xs text-muted">
            Enter either grams or lb &amp; oz. Used for the weight chart on
            the home page.
          </p>
          <label className="text-xs text-muted">When</label>
          <input
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
            className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted">lb</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={weightLb}
                onChange={(e) => {
                  setWeightLb(e.target.value);
                  if (e.target.value) setWeightGrams("");
                }}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted">oz</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={weightOz}
                onChange={(e) => {
                  setWeightOz(e.target.value);
                  if (e.target.value) setWeightGrams("");
                }}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">Or grams</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="e.g. 3450"
              value={weightGrams}
              onChange={(e) => {
                setWeightGrams(e.target.value);
                if (e.target.value) {
                  setWeightLb("");
                  setWeightOz("");
                }
              }}
              className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <button
            type="button"
            onClick={submitWeight}
            disabled={weightBusy}
            className="self-start rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {weightBusy ? "Saving…" : "Log weight"}
          </button>
          {weightFlash && (
            <p className="text-xs text-muted">{weightFlash}</p>
          )}
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

        <Section title="Charts">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showGrowthCurves}
              onChange={(e) => setShowGrowthCurves(e.target.checked)}
              className="w-4 h-4 mt-0.5 shrink-0"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                Show growth reference curves
              </span>
              <span className="text-xs text-muted leading-snug">
                Adds WHO p3 / p50 / p97 weight-for-age curves behind the weight
                chart. Off by default — newborn weight dips are normal and the
                curves can read as alarming.
              </span>
            </span>
          </label>
        </Section>

        <Section title="Export">
          <p className="text-xs text-muted">
            Download every logged event as a CSV file — handy for pediatrician
            visits or backups.
          </p>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exportBusy}
            className="self-start rounded-xl border border-accent-soft bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:border-accent/60 disabled:opacity-60"
          >
            {exportBusy ? "Preparing…" : "Download CSV"}
          </button>
          {exportError && (
            <p className="text-xs text-rose-600">{exportError}</p>
          )}
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

function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function eventsToCsv(events: BabyEvent[]): string {
  const header = [
    "id",
    "occurred_at",
    "type",
    "created_by_email",
    "created_at",
    "details",
  ];
  const rows = events.map((e) => {
    const { id, occurred_at, type, created_by_email, created_at, ...rest } =
      e as unknown as Record<string, unknown>;
    const occurredIso =
      occurred_at && typeof occurred_at === "object" && "toDate" in (occurred_at as object)
        ? (occurred_at as { toDate: () => Date }).toDate().toISOString()
        : "";
    const createdIso =
      created_at && typeof created_at === "object" && "toDate" in (created_at as object)
        ? (created_at as { toDate: () => Date }).toDate().toISOString()
        : "";
    // Strip base fields already in columns, plus deleted/updated_at.
    const details: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (
        k === "deleted" ||
        k === "updated_at" ||
        k === "created_by"
      )
        continue;
      details[k] = v;
    }
    return [
      csvEscape(id),
      csvEscape(occurredIso),
      csvEscape(type),
      csvEscape(created_by_email ?? ""),
      csvEscape(createdIso),
      csvEscape(details),
    ].join(",");
  });
  return [header.join(","), ...rows].join("\r\n");
}
