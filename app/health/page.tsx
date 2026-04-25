"use client";

import { useEffect, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useAuth } from "../providers";
import { useBaby } from "@/lib/useBaby";
import { useHouseholdId } from "@/lib/useHousehold";
import { getDb } from "@/lib/firebase";
import Link from "next/link";

type HouseholdInfo = {
  exists: boolean;
  baby?: { name?: string; fullName?: string };
  member_emails?: string[];
};

type Counts = {
  newPath: number | "—";
  legacy: number | "—";
  latest?: { occurredAt: Date; type: string } | null;
};

export default function HealthPage() {
  const { user } = useAuth();
  const baby = useBaby();
  const hid = useHouseholdId();
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [counts, setCounts] = useState<Counts>({ newPath: "—", legacy: "—" });
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);

  useEffect(() => {
    if (!hid) return;
    const db = getDb();
    (async () => {
      try {
        const hSnap = await getDoc(doc(db, "households", hid));
        if (hSnap.exists()) {
          const d = hSnap.data();
          setHousehold({
            exists: true,
            baby: d.baby,
            member_emails: d.member_emails,
          });
        } else {
          setHousehold({ exists: false });
        }
      } catch (err) {
        setHousehold({ exists: false });
        console.error("household read failed", err);
      }
    })();

    (async () => {
      let newCount: number | "—" = "—";
      let legacyCount: number | "—" = "—";
      let latest: Counts["latest"] = null;
      try {
        const c = await getCountFromServer(
          collection(db, "households", hid, "events"),
        );
        newCount = c.data().count;
      } catch {
        /* ignore */
      }
      try {
        const c = await getCountFromServer(collection(db, "events"));
        legacyCount = c.data().count;
      } catch {
        /* ignore */
      }
      try {
        const q = query(
          collection(db, "households", hid, "events"),
          orderBy("occurred_at", "desc"),
          limit(1),
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          latest = {
            occurredAt: (data.occurred_at as Timestamp).toDate(),
            type: data.type,
          };
        });
      } catch {
        /* ignore */
      }
      setCounts({ newPath: newCount, legacy: legacyCount, latest });
    })();
  }, [hid]);

  async function runWriteProbe() {
    if (!hid || !user) return;
    setProbeBusy(true);
    setProbeMsg(null);
    try {
      const db = getDb();
      const ref = await addDoc(collection(db, "households", hid, "events"), {
        type: "diaper_wet",
        occurred_at: Timestamp.now(),
        created_by: user.uid,
        created_by_email: user.email ?? null,
        created_at: Timestamp.now(),
        deleted: true, // marked deleted so it never shows in history
        _probe: true,
      });
      // Soft-delete already; now hard-delete to clean up.
      await deleteDoc(ref);
      setProbeMsg(`✓ write+delete probe succeeded (${ref.id})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProbeMsg(`✗ probe failed: ${msg}`);
    } finally {
      setProbeBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Health</h1>
          <Link href="/" className="text-xs text-muted underline">
            ← home
          </Link>
        </div>

        <Section title="Identity">
          <Row label="signed in" value={user?.email ?? "—"} />
          <Row label="uid" value={user?.uid ?? "—"} mono />
          <Row label="resolved hid" value={hid ?? "—"} mono />
          <Row label="baby" value={`${baby.name} (${baby.id})`} />
        </Section>

        <Section title="Household doc">
          {household === null ? (
            <Row label="status" value="loading…" />
          ) : household.exists ? (
            <>
              <Row label="exists" value="✓ yes" />
              <Row label="baby.name" value={household.baby?.name ?? "—"} />
              <Row
                label="member_emails"
                value={(household.member_emails ?? []).join(", ") || "—"}
              />
            </>
          ) : (
            <Row
              label="exists"
              value="✗ no — household doc not seeded"
              warn
            />
          )}
        </Section>

        <Section title="Events">
          <Row
            label="count (new path)"
            value={String(counts.newPath)}
            warn={counts.newPath === 0}
          />
          <Row label="count (legacy)" value={String(counts.legacy)} />
          <Row
            label="latest event"
            value={
              counts.latest
                ? `${counts.latest.type} @ ${counts.latest.occurredAt.toLocaleString()}`
                : "—"
            }
          />
        </Section>

        <Section title="Write probe">
          <button
            type="button"
            onClick={runWriteProbe}
            disabled={probeBusy || !hid}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {probeBusy ? "Running…" : "Run write+delete probe"}
          </button>
          {probeMsg && (
            <p className="text-xs font-mono mt-2 break-words">{probeMsg}</p>
          )}
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
    <section className="rounded-2xl border border-accent-soft bg-surface p-4 flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wider text-muted">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  warn,
}: {
  label: string;
  value: string;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span
        className={
          (warn ? "text-amber-600 " : "") +
          (mono ? "font-mono text-xs " : "") +
          "text-right break-all"
        }
      >
        {value}
      </span>
    </div>
  );
}
