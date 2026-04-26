/**
 * Local-only emulator verification for the daily-summaries refactor.
 * NOT a production tool. NOT a unit test. Just spins up admin SDK against
 * the emulator, seeds a household + events, runs the same delta math the
 * backfill uses, and prints a summary diff for spot-checking.
 *
 * Usage (assumes firebase emulator already running):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/verify-summaries-emulator.ts
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing: FIRESTORE_EMULATOR_HOST must be set (emulator only).");
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "babylog-ea6b2";
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();

const HID = "mcintire";
const TODAY = new Date(2026, 3, 26, 12, 0); // 2026-04-26 noon
const YESTERDAY = new Date(2026, 3, 25, 12, 0);
const DAY_BEFORE = new Date(2026, 3, 24, 12, 0);

function ts(d: Date): Timestamp {
  return Timestamp.fromDate(d);
}

async function clearCollections() {
  const cols = ["events", "daily_summaries"] as const;
  for (const c of cols) {
    const snap = await db.collection(`households/${HID}/${c}`).get();
    for (const d of snap.docs) await d.ref.delete();
  }
}

async function seed() {
  // Household doc
  await db.doc(`households/${HID}`).set(
    {
      member_emails: ["ryanpmcintire@gmail.com"],
      baby: { name: "Lily" },
    },
    { merge: true },
  );

  // Events spanning 3 days. Counts we expect after backfill:
  //   2026-04-24: 1 bottle (90ml), 1 wet, 1 dirty, 1 mixed, 1 temp 99.4, 1 med
  //   2026-04-25: 1 breast, 1 pump (60ml), 1 sleep_start (22:00) → no end
  //                ⇒ explicit sleep auto-closed by next-day feed at 06:00
  //                  contributing 120 min to 2026-04-25 + 360 min to 2026-04-26
  //   2026-04-26: 1 breast (06:00), 1 bottle (60ml), 2 wets
  function evt(type: string, at: Date, extra: Record<string, unknown> = {}) {
    return {
      type,
      occurred_at: ts(at),
      created_at: ts(at),
      created_by: "uid-test",
      created_by_email: "ryanpmcintire@gmail.com",
      deleted: false,
      ...extra,
    };
  }
  const events = [
    evt("bottle_feed", new Date(2026, 3, 24, 9, 0), {
      volume_ml: 90,
      milk_types: ["mom_pumped"],
    }),
    evt("diaper_wet", new Date(2026, 3, 24, 10, 0)),
    evt("diaper_dirty", new Date(2026, 3, 24, 11, 0)),
    evt("diaper_mixed", new Date(2026, 3, 24, 14, 0)),
    evt("temperature", new Date(2026, 3, 24, 15, 0), { temp_f: 99.4 }),
    evt("medication", new Date(2026, 3, 24, 16, 0), { name: "Tylenol" }),

    evt("breast_feed", YESTERDAY, { outcome: "latched_fed" }),
    evt("pump", new Date(2026, 3, 25, 14, 0), { volume_ml: 60 }),
    evt("sleep_start", new Date(2026, 3, 25, 22, 0)),

    evt("breast_feed", new Date(2026, 3, 26, 6, 0), { outcome: "latched_fed" }),
    evt("bottle_feed", new Date(2026, 3, 26, 9, 0), {
      volume_ml: 60,
      milk_types: ["mom_pumped"],
    }),
    evt("diaper_wet", new Date(2026, 3, 26, 9, 30)),
    evt("diaper_wet", new Date(2026, 3, 26, 11, 0)),
  ];
  for (const e of events) {
    await db.collection(`households/${HID}/events`).add(e);
  }
  console.log(`  seeded ${events.length} events for ${HID}`);
}

async function runBackfill() {
  // Shell out to the actual backfill script with --execute so we exercise
  // the same code path the user will run.
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/backfill-summaries.ts",
      "--execute",
    ],
    {
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_PROJECT_ID: projectId,
      },
      stdio: "inherit",
      shell: true,
    },
  );
  if (r.status !== 0) throw new Error(`backfill exited ${r.status}`);
}

async function inspect() {
  const snap = await db
    .collection(`households/${HID}/daily_summaries`)
    .orderBy("__name__")
    .get();
  console.log(`\n=== Resulting daily_summaries (${snap.size}) ===`);
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const { updated_at: _u, ...rest } = data;
    console.log(`  ${d.id}: ${JSON.stringify(rest)}`);
  }
}

async function main() {
  console.log(`→ clearing households/${HID} (events + daily_summaries)`);
  await clearCollections();
  console.log(`→ seeding`);
  await seed();
  console.log(`→ running backfill`);
  await runBackfill();
  await inspect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
