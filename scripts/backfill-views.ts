/**
 * Backfill: materialize home/insights/library view docs from existing events.
 * Idempotent — overwrites the view docs each run.
 *
 * Defaults to emulator. Touching prod requires BOTH --prod and --execute.
 *
 * Usage:
 *   # Emulator dry-run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-views.ts
 *
 *   # Emulator execute:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-views.ts --execute
 *
 *   # Prod execute:
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/backfill-views.ts --prod --execute
 */

import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Timestamp as ClientTimestamp } from "firebase/firestore";
import { getAllHouseholdSeeds } from "../lib/household";
import {
  computeHomeView,
  computeInsightsView,
  computeLibraryView,
} from "../lib/views";
import type { BabyEvent } from "../lib/events";

const isProd = process.argv.includes("--prod");
const doExecute = process.argv.includes("--execute");
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("FIREBASE_PROJECT_ID is required");
  process.exit(1);
}
if (isProd && isEmulator) {
  console.error("Refusing: --prod and FIRESTORE_EMULATOR_HOST both set.");
  process.exit(1);
}
if (isProd && !doExecute) {
  console.error("Refusing: --prod requires --execute.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp(
    isEmulator ? { projectId } : { credential: applicationDefault(), projectId },
  );
}
const db = getFirestore();

async function prodConfirmGate(): Promise<void> {
  if (!isProd) return;
  console.log("\n⚠️  PROD VIEW BACKFILL ⚠️");
  console.log("   Will WRITE views/home, views/insights, views/library");
  console.log("   for each household. Each is overwritten — safe to re-run.");
  console.log("   Continuing in 5s. Ctrl+C to abort.\n");
  await new Promise((r) => setTimeout(r, 5000));
}

// Convert admin-SDK Timestamp fields on the event docs to client-SDK
// Timestamps so the pure compute functions (which type events with the
// client SDK Timestamp) accept them. The runtime API shape is the same;
// it's only TypeScript that cares.
type AdminEventDoc = Record<string, unknown> & {
  occurred_at: Timestamp;
  created_at: Timestamp;
  updated_at?: Timestamp;
  deleted?: boolean;
  type: string;
};

function toClientEvent(id: string, raw: AdminEventDoc): BabyEvent {
  const fix = (t: Timestamp | undefined): ClientTimestamp | undefined =>
    t
      ? new ClientTimestamp(t.seconds, t.nanoseconds)
      : undefined;
  const base: Record<string, unknown> = {
    ...raw,
    id,
    occurred_at: fix(raw.occurred_at),
    created_at: fix(raw.created_at),
  };
  if (raw.updated_at) base.updated_at = fix(raw.updated_at);
  return base as BabyEvent;
}

async function backfillHousehold(hid: string): Promise<{
  events: number;
}> {
  const eventsSnap = await db.collection(`households/${hid}/events`).get();
  const events: BabyEvent[] = eventsSnap.docs.map((d) =>
    toClientEvent(d.id, d.data() as AdminEventDoc),
  );
  console.log(`  ${hid}: ${events.length} events`);

  const home = computeHomeView(events);
  const insights = computeInsightsView(events);
  const library = computeLibraryView(events);

  if (!doExecute) return { events: events.length };

  const batch = db.batch();
  batch.set(db.doc(`households/${hid}/views/home`), {
    ...home,
    updated_at: Timestamp.now(),
  });
  batch.set(db.doc(`households/${hid}/views/insights`), {
    ...insights,
    updated_at: Timestamp.now(),
  });
  batch.set(db.doc(`households/${hid}/views/library`), {
    ...library,
    updated_at: Timestamp.now(),
  });
  await batch.commit();
  return { events: events.length };
}

async function main() {
  const target = isEmulator ? "EMULATOR" : isProd ? "PROD" : "default";
  console.log(`\nbabylog views backfill — ${target} (project: ${projectId})`);
  console.log(`  mode: ${doExecute ? "EXECUTE" : "DRY-RUN"}`);
  await prodConfirmGate();

  let totalEvents = 0;
  for (const seed of getAllHouseholdSeeds()) {
    const r = await backfillHousehold(seed.hid);
    totalEvents += r.events;
  }
  console.log("\n=== Done ===");
  console.log(`  events scanned : ${totalEvents}`);
  if (!doExecute) console.log("\n  (dry-run — pass --execute to write)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
