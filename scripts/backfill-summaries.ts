/**
 * Backfill: derive per-day rollups from existing events and write them to
 * households/{hid}/daily_summaries/{YYYY-MM-DD}.
 *
 * Idempotent: each daily_summary doc is fully recomputed from that day's
 * events and overwritten. Safe to re-run any number of times.
 *
 * Defaults to emulator. Touching prod requires BOTH --prod and --execute.
 *
 * Usage:
 *   # Emulator (default), dry-run preview:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-summaries.ts
 *
 *   # Emulator, actually write:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-summaries.ts --execute
 *
 *   # Prod (requires both flags + service account):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-summaries.ts --prod --execute
 */

import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAllHouseholdSeeds } from "../lib/household";
import {
  dayKeyOf,
  deltaForEvent,
  splitSleepMinutes,
  type DailySummary,
} from "../lib/summaries";

type EventDoc = {
  type: string;
  occurred_at: Timestamp;
  deleted?: boolean;
  volume_ml?: number;
  temp_f?: number;
  [k: string]: unknown;
};

const isProd = process.argv.includes("--prod");
const doExecute = process.argv.includes("--execute");
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("FIREBASE_PROJECT_ID is required");
  process.exit(1);
}
if (isProd && isEmulator) {
  console.error(
    "Refusing to run: --prod and FIRESTORE_EMULATOR_HOST are both set.",
  );
  process.exit(1);
}
if (isProd && !doExecute) {
  console.error(
    "Refusing to run: --prod requires --execute (this is the safety gate).",
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp(
    isEmulator
      ? { projectId }
      : { credential: applicationDefault(), projectId },
  );
}
const db = getFirestore();

async function prodConfirmGate(): Promise<void> {
  if (!isProd) return;
  console.log("\n⚠️  PROD BACKFILL ⚠️");
  console.log("   Will WRITE daily_summaries for all households.");
  console.log("   Each doc is overwritten — safe to re-run.");
  console.log("   Continuing in 5 seconds. Ctrl+C to abort.\n");
  await new Promise((r) => setTimeout(r, 5000));
}

// Mirrors lib/aggregates.ts constants. Kept inline to avoid pulling the
// client-SDK module into the admin-SDK script.
const PRE_EVENT_AWAKE_MIN = 5;
const POST_EVENT_AWAKE_MIN = 20;
const AWAKE_MERGE_THRESHOLD_MIN = 15;
const MIN_INFERRED_SLEEP_MIN = 20;

// Walk events newest-first (matches lib/aggregates explicitSleepWindows
// expectation) and emit closed sleep windows. Open trailing window is
// dropped — sleep currently in progress doesn't get backfilled into a
// historical summary; it'll be picked up when the user logs sleep_end.
function explicitSleepWindowsAdmin(
  events: EventDoc[],
): { start: Date; end: Date }[] {
  const newestFirst = [...events].sort(
    (a, b) => b.occurred_at.toMillis() - a.occurred_at.toMillis(),
  );
  const chrono = newestFirst.reverse();
  const windows: { start: Date; end: Date }[] = [];
  let open: Date | null = null;
  for (const e of chrono) {
    if (e.deleted) continue;
    if (e.type === "sleep_start") {
      if (open) {
        // Two starts in a row — close the earlier one at the new start.
        windows.push({ start: open, end: e.occurred_at.toDate() });
      }
      open = e.occurred_at.toDate();
    } else if (e.type === "sleep_end" && open) {
      windows.push({ start: open, end: e.occurred_at.toDate() });
      open = null;
    } else if (
      open &&
      (e.type === "breast_feed" ||
        e.type === "bottle_feed" ||
        e.type === "diaper_wet" ||
        e.type === "diaper_dirty")
    ) {
      // User forgot wake; subsequent feed/diaper implies awake.
      windows.push({ start: open, end: e.occurred_at.toDate() });
      open = null;
    }
  }
  // Drop trailing open window — see header comment.
  return windows;
}

// Build awake intervals from feeds + diapers, with pre/post buffers and
// merging of nearby intervals. Mirrors lib/aggregates.buildAwakeIntervals.
function buildAwakeIntervalsAdmin(
  events: EventDoc[],
): { start: Date; end: Date }[] {
  const preMs = PRE_EVENT_AWAKE_MIN * 60 * 1000;
  const postMs = POST_EVENT_AWAKE_MIN * 60 * 1000;
  const mergeMs = AWAKE_MERGE_THRESHOLD_MIN * 60 * 1000;

  const raw: { start: Date; end: Date }[] = [];
  for (const e of events) {
    if (e.deleted) continue;
    if (
      e.type === "breast_feed" ||
      e.type === "bottle_feed" ||
      e.type === "diaper_wet" ||
      e.type === "diaper_dirty"
    ) {
      const atMs = e.occurred_at.toMillis();
      raw.push({
        start: new Date(atMs - preMs),
        end: new Date(atMs + postMs),
      });
    }
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [{ ...raw[0]! }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1]!;
    const cur = raw[i]!;
    if (cur.start.getTime() - prev.end.getTime() <= mergeMs) {
      if (cur.end.getTime() > prev.end.getTime()) prev.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

// Inferred sleep = the gaps between awake intervals, with explicit sleep
// subtracted (explicit takes precedence) and short windows dropped.
// Mirrors lib/aggregates.inferredSleepWindows but without the trailing
// "extends to now" tail since backfill operates on the past only.
function inferredSleepWindowsAdmin(
  events: EventDoc[],
  explicit: { start: Date; end: Date }[],
): { start: Date; end: Date }[] {
  const awakes = buildAwakeIntervalsAdmin(events);
  if (awakes.length === 0) return [];

  let windows: { start: Date; end: Date }[] = [];
  for (let i = 0; i < awakes.length - 1; i++) {
    const start = awakes[i]!.end;
    const end = awakes[i + 1]!.start;
    if (end > start) windows.push({ start, end });
  }

  for (const ex of explicit) {
    windows = windows.flatMap((w) => subtractRange(w, ex.start, ex.end));
  }

  const minMs = MIN_INFERRED_SLEEP_MIN * 60 * 1000;
  return windows.filter((w) => w.end.getTime() - w.start.getTime() >= minMs);
}

function subtractRange(
  w: { start: Date; end: Date },
  removeStart: Date,
  removeEnd: Date,
): { start: Date; end: Date }[] {
  if (removeEnd <= w.start || removeStart >= w.end) return [w];
  if (removeStart <= w.start && removeEnd >= w.end) return [];
  if (removeStart > w.start && removeEnd < w.end) {
    return [
      { start: w.start, end: removeStart },
      { start: removeEnd, end: w.end },
    ];
  }
  if (removeStart <= w.start) return [{ start: removeEnd, end: w.end }];
  return [{ start: w.start, end: removeStart }];
}

function buildSummariesForHousehold(
  events: EventDoc[],
): Map<string, DailySummary> {
  const byDay = new Map<string, DailySummary>();
  function ensure(dayKey: string): DailySummary {
    let s = byDay.get(dayKey);
    if (!s) {
      s = {
        dayKey,
        feeds: 0,
        breast_feeds: 0,
        bottle_feeds: 0,
        pump_count: 0,
        milkMl: 0,
        pumpMl: 0,
        diapers: 0,
        wets: 0,
        dirties: 0,
        mixeds: 0,
        meds: 0,
        sleepMinutes: 0,
        maxTempF: null,
      };
      byDay.set(dayKey, s);
    }
    return s;
  }

  for (const e of events) {
    if (e.deleted) continue;
    const at = e.occurred_at.toDate();
    const k = dayKeyOf(at);
    const s = ensure(k);

    if (e.type === "temperature") {
      const t = e.temp_f;
      if (typeof t === "number") {
        if (s.maxTempF === null || t > s.maxTempF) s.maxTempF = t;
      }
      continue;
    }
    const d = deltaForEvent({
      type: e.type as never,
      volume_ml: e.volume_ml,
    });
    if (!d) continue;
    if (d.feeds) s.feeds += d.feeds;
    if (d.breast_feeds) s.breast_feeds += d.breast_feeds;
    if (d.bottle_feeds) s.bottle_feeds += d.bottle_feeds;
    if (d.pump_count) s.pump_count += d.pump_count;
    if (d.milkMl) s.milkMl += d.milkMl;
    if (d.pumpMl) s.pumpMl += d.pumpMl;
    if (d.diapers) s.diapers += d.diapers;
    if (d.wets) s.wets += d.wets;
    if (d.dirties) s.dirties += d.dirties;
    if (d.mixeds) s.mixeds += d.mixeds;
    if (d.meds) s.meds += d.meds;
  }

  const explicit = explicitSleepWindowsAdmin(events);
  for (const w of explicit) {
    const split = splitSleepMinutes(w.start, w.end);
    for (const [k, mins] of Object.entries(split)) {
      ensure(k).sleepMinutes += mins;
    }
  }
  // Inferred sleep fills gaps so historical totals match what the live
  // chart used to render. Going forward the dual-write path tracks only
  // explicit sleep on each sleep_end write.
  for (const w of inferredSleepWindowsAdmin(events, explicit)) {
    const split = splitSleepMinutes(w.start, w.end);
    for (const [k, mins] of Object.entries(split)) {
      ensure(k).sleepMinutes += mins;
    }
  }

  return byDay;
}

async function backfillHousehold(hid: string): Promise<{
  events: number;
  days: number;
  written: number;
}> {
  const eventsSnap = await db.collection(`households/${hid}/events`).get();
  const events: EventDoc[] = eventsSnap.docs.map(
    (d) => d.data() as EventDoc,
  );
  const summaries = buildSummariesForHousehold(events);
  console.log(
    `  ${hid}: ${events.length} events → ${summaries.size} day buckets`,
  );

  if (!doExecute) {
    return { events: events.length, days: summaries.size, written: 0 };
  }

  let batch = db.batch();
  let inBatch = 0;
  let written = 0;
  const FLUSH_AT = 400;
  for (const [dayKey, summary] of summaries) {
    const ref = db.doc(`households/${hid}/daily_summaries/${dayKey}`);
    batch.set(ref, {
      ...summary,
      updated_at: Timestamp.now(),
    });
    inBatch++;
    written++;
    if (inBatch >= FLUSH_AT) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`    … committed (running total: ${written})`);
    }
  }
  if (inBatch > 0) await batch.commit();
  return { events: events.length, days: summaries.size, written };
}

async function main() {
  const target = isEmulator ? "EMULATOR" : isProd ? "PROD" : "default";
  console.log(
    `\nbabylog daily-summaries backfill — ${target} (project: ${projectId})`,
  );
  console.log(`  mode: ${doExecute ? "EXECUTE" : "DRY-RUN"}`);
  await prodConfirmGate();

  const totals = { events: 0, days: 0, written: 0 };
  for (const seed of getAllHouseholdSeeds()) {
    const r = await backfillHousehold(seed.hid);
    totals.events += r.events;
    totals.days += r.days;
    totals.written += r.written;
  }
  console.log("\n=== Done ===");
  console.log(`  events scanned : ${totals.events}`);
  console.log(`  day buckets    : ${totals.days}`);
  console.log(`  docs written   : ${totals.written}`);
  if (!doExecute) {
    console.log("\n  (dry-run — pass --execute to actually write)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
