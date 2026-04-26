/**
 * One-time backfill: pair existing `diaper_wet` + `diaper_dirty` events that
 * occurred within 5 minutes of each other and convert each pair into a single
 * `diaper_mixed` event. Preserves the earlier timestamp + the original creator.
 *
 * Strategy:
 *   - Replace the EARLIER event of the pair (in-place update) with type
 *     diaper_mixed. This keeps a stable doc id for any references.
 *   - Soft-delete the LATER event of the pair.
 *   - Both writes happen atomically per pair via a batch.
 *
 * Defaults to dry-run. Pass --apply to actually write.
 *
 * Usage:
 *   # Emulator dry-run:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/merge-mixed-diapers.ts
 *
 *   # Emulator apply:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/merge-mixed-diapers.ts --apply
 *
 *   # Prod apply:
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/merge-mixed-diapers.ts --apply --prod
 */

import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAllHouseholdSeeds } from "../lib/household";

const PAIR_WINDOW_MS = 5 * 60 * 1000;

const isApply = process.argv.includes("--apply");
const isProd = process.argv.includes("--prod");
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("FIREBASE_PROJECT_ID is required");
  process.exit(1);
}
if (isProd && isEmulator) {
  console.error("Refusing to run: --prod is set but FIRESTORE_EMULATOR_HOST is also set.");
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

type DiaperRow = {
  id: string;
  type: "diaper_wet" | "diaper_dirty";
  occurred_at: FirebaseFirestore.Timestamp;
  ref: FirebaseFirestore.DocumentReference;
};

async function processHousehold(hid: string) {
  console.log(`\n→ household: ${hid}`);
  const col = db.collection(`households/${hid}/events`);
  // No orderBy here — composite "type ASC + occurred_at ASC" index isn't
  // deployed and isn't worth deploying for a one-shot script. Sort in memory
  // after fetching (a few hundred docs at most).
  const snap = await col
    .where("type", "in", ["diaper_wet", "diaper_dirty"])
    .get();

  const rows: DiaperRow[] = [];
  snap.forEach((d) => {
    const data = d.data() as {
      type: "diaper_wet" | "diaper_dirty";
      occurred_at: FirebaseFirestore.Timestamp;
      deleted?: boolean;
    };
    if (data.deleted) return;
    rows.push({
      id: d.id,
      type: data.type,
      occurred_at: data.occurred_at,
      ref: d.ref,
    });
  });
  rows.sort((a, b) => a.occurred_at.toMillis() - b.occurred_at.toMillis());

  console.log(`  scanning ${rows.length} live diaper events`);

  // Pair up: walk chronologically, when we find a wet+dirty within 5 min of
  // each other (in either order) and neither has been claimed, pair them.
  const claimed = new Set<string>();
  type Pair = { earlier: DiaperRow; later: DiaperRow };
  const pairs: Pair[] = [];

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    if (claimed.has(a.id)) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      if (claimed.has(b.id)) continue;
      const dt = b.occurred_at.toMillis() - a.occurred_at.toMillis();
      if (dt > PAIR_WINDOW_MS) break; // sorted asc; no further candidate
      if (a.type === b.type) continue; // need one wet + one dirty
      claimed.add(a.id);
      claimed.add(b.id);
      pairs.push({ earlier: a, later: b });
      break;
    }
  }

  console.log(`  found ${pairs.length} mergeable pairs`);
  if (pairs.length === 0) return;

  for (const { earlier, later } of pairs.slice(0, 10)) {
    const dtSec = Math.round(
      (later.occurred_at.toMillis() - earlier.occurred_at.toMillis()) / 1000,
    );
    console.log(
      `    · ${earlier.id} (${earlier.type}) + ${later.id} (${later.type}) — Δ${dtSec}s @ ${earlier.occurred_at.toDate().toISOString()}`,
    );
  }
  if (pairs.length > 10) {
    console.log(`    … and ${pairs.length - 10} more`);
  }

  if (!isApply) {
    console.log("  [dry-run] no writes. Pass --apply to commit.");
    return;
  }

  // Commit in batches of 200 ops (each pair = 2 writes, so ~100 pairs/batch).
  const BATCH_SIZE = 100;
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = pairs.slice(i, i + BATCH_SIZE);
    for (const { earlier, later } of slice) {
      batch.update(earlier.ref, {
        type: "diaper_mixed",
        updated_at: FieldValue.serverTimestamp(),
        merged_from: [earlier.id, later.id],
      });
      batch.update(later.ref, {
        deleted: true,
        updated_at: FieldValue.serverTimestamp(),
        merged_into: earlier.id,
      });
    }
    await batch.commit();
    console.log(`  ✓ committed ${slice.length} pairs (cumulative ${Math.min(i + BATCH_SIZE, pairs.length)}/${pairs.length})`);
  }
}

async function main() {
  console.log(
    `\nbabylog mixed-diaper backfill — ${isEmulator ? "EMULATOR" : isProd ? "PROD" : "default"} (project: ${projectId}, ${isApply ? "APPLY" : "dry-run"})`,
  );
  if (isProd) {
    console.log("⚠️  PROD mode. Continuing in 5 seconds. Ctrl+C to abort.");
    await new Promise((r) => setTimeout(r, 5000));
  }
  for (const seed of getAllHouseholdSeeds()) {
    await processHousehold(seed.hid);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
