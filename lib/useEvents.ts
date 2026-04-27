"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
import { getHouseholdIdForEmail } from "./household";
import { useHouseholdId } from "./useHousehold";
import {
  dayKeyOf,
  deltaForEvent,
  inverseDelta,
  splitSleepMinutes,
  type DailySummary,
  type SummaryDelta,
} from "./summaries";
import {
  applyChangeToLibraryView,
  computeHomeView,
  computeInsightsView,
  computeLibraryView,
  preserveLatestPointers,
  type HomeView,
  type InsightsView,
  type LibraryView,
  type ViewChange,
} from "./views";
import type {
  BabyEvent,
  BreastFeedOutcome,
  FoodReaction,
  MilkType,
  Side,
  TempMethod,
} from "./events";

// Dual-write to households/{hid}/daily_summaries/* gated behind this flag.
// Default false so prod is unaffected until cutover. Flip to "true" in
// Vercel env after backfill is run against prod.
const SUMMARIES_ENABLED =
  process.env.NEXT_PUBLIC_USE_SUMMARIES === "true";

// Materialized per-screen view docs at households/{hid}/views/{home,insights,library}.
// When enabled, every event write/edit/delete also rewrites the relevant
// view docs, so the home page reads exactly one doc and the insights/library
// tabs read one doc each. Default false so prod stays on the previous read
// path until Vercel env is flipped.
const VIEWS_ENABLED =
  process.env.NEXT_PUBLIC_USE_VIEWS === "true";

// Resolve the household id for a write operation. Throws if the signed-in
// user has no mapping — should never happen in practice (allowlist gates
// sign-in on the same set of emails).
function requireHouseholdId(): string {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const hid = getHouseholdIdForEmail(user.email);
  if (!hid) throw new Error("No household for current user");
  return hid;
}

// Path: households/{hid}/events
function eventsCollection(hid: string) {
  return collection(getDb(), "households", hid, "events");
}

function eventDoc(hid: string, eventId: string) {
  return doc(getDb(), "households", hid, "events", eventId);
}

function summaryDoc(hid: string, dayKey: string) {
  return doc(getDb(), "households", hid, "daily_summaries", dayKey);
}

function homeViewDoc(hid: string) {
  return doc(getDb(), "households", hid, "views", "home");
}

function insightsViewDoc(hid: string) {
  return doc(getDb(), "households", hid, "views", "insights");
}

function libraryViewDoc(hid: string) {
  return doc(getDb(), "households", hid, "views", "library");
}

// Apply (insert | replace | delete) of one event to a newest-first events
// array. Pure — used by the dual-write to project the array forward and
// hand it to computeHomeView / computeInsightsView / computeLibraryView.
function applyEventChange(
  events: BabyEvent[],
  change:
    | { kind: "insert"; event: BabyEvent }
    | { kind: "replace"; event: BabyEvent }
    | { kind: "delete"; eventId: string },
): BabyEvent[] {
  if (change.kind === "delete") {
    return events.filter((e) => e.id !== change.eventId);
  }
  const without = events.filter((e) => e.id !== change.event.id);
  without.push(change.event);
  without.sort(
    (a, b) => b.occurred_at.toMillis() - a.occurred_at.toMillis(),
  );
  return without;
}

// Apply an event change to all three view docs and stage the writes onto
// the existing batch. Self-sufficient — reads the existing view docs to
// merge with whatever currentEvents the caller provided, so writes from
// places that don't have a full events array (Library tab, Settings page)
// still update the views correctly.
//
// HomeView: recompute from (existing recent_events + currentEvents + change),
//   then preserve sparse-type latest pointers from the existing view that
//   the recompute can't see (older than the 50-event window).
// InsightsView: same recompute pattern (best-effort; counts and recent
//   markers are correct, very-old markers/weights drift but heal via
//   backfill).
// LibraryView: incremental dedupe-update on book_read / food_tried events;
//   noop for other types. Books/foods deduped by key, so insert is
//   monotonic and doesn't depend on having full event history.
async function stageViewWrites(
  batch: ReturnType<typeof writeBatch>,
  hid: string,
  currentEvents: BabyEvent[] | null | undefined,
  change: ViewChange,
): Promise<void> {
  if (!VIEWS_ENABLED) return;

  const [homeSnap, libSnap] = await Promise.all([
    getDoc(homeViewDoc(hid)),
    getDoc(libraryViewDoc(hid)),
  ]);
  const existingHome = homeSnap.exists()
    ? (homeSnap.data() as HomeView)
    : null;
  const existingLib: LibraryView = libSnap.exists()
    ? (libSnap.data() as LibraryView)
    : { books: [], foods: [] };

  const existingRecent = existingHome?.recent_events ?? [];
  const byId = new Map<string, BabyEvent>();
  for (const e of existingRecent) byId.set(e.id, e);
  for (const e of currentEvents ?? []) byId.set(e.id, e);
  const projected = applyEventChange(Array.from(byId.values()), change);

  const now = new Date();
  const home = computeHomeView(projected, now);
  // Sparse-type pointers (last weight, last book, etc.) may live outside
  // the 50-event window the recompute saw — preserve them from the
  // existing view unless the change deletes/replaces that exact event.
  home.latest = preserveLatestPointers(home.latest, existingHome?.latest, change);

  const insights = computeInsightsView(projected, now);
  const library = applyChangeToLibraryView(existingLib, change);

  batch.set(homeViewDoc(hid), { ...home, updated_at: Timestamp.now() });
  batch.set(insightsViewDoc(hid), {
    ...insights,
    updated_at: Timestamp.now(),
  });
  batch.set(libraryViewDoc(hid), {
    ...library,
    updated_at: Timestamp.now(),
  });
}

// Convert a SummaryDelta into a Firestore update payload using
// FieldValue.increment for each numeric field. set(merge:true) creates the
// summary doc on first write for a given day.
function deltaToIncrements(delta: SummaryDelta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v === "number" && v !== 0) out[k] = increment(v);
  }
  return out;
}

// Old top-level events path. Read-only fallback during the Phase B transition
// window. Remove once the legacy collection is deleted.
function legacyEventsCollection() {
  return collection(getDb(), "events");
}

export type EventsSource = "new" | "legacy" | null;

// Live listener query is intentionally stable across mounts:
//   orderBy occurred_at desc, limit N
// No date filter. Firestore's persistent cache reuses a resume token when
// the query is identical between sessions, so cache-hit reloads cost 0 reads
// and only doc changes bill. A dynamic where-clause with Date.now() inside
// produces a "different" query every mount and forces a full re-sync.
//
// Default count: tight when views are on (only feeds the dual-write's
// projection of changes onto recent state — chart/dashboard renders read
// the materialized view doc instead). Wider when views are off so the
// legacy in-memory bucketing path has enough history.
export function useRecentEvents(
  maxCount = VIEWS_ENABLED ? 200 : 500,
): {
  events: BabyEvent[];
  loading: boolean;
  error: string | null;
  source: EventsSource;
} {
  const hid = useHouseholdId();
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<EventsSource>(null);

  useEffect(() => {
    if (!hid) return;
    let cancelled = false;
    let triedLegacyFallback = false;
    const q = query(
      eventsCollection(hid),
      orderBy("occurred_at", "desc"),
      limit(maxCount),
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        if (cancelled) return;
        const list: BabyEvent[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<BabyEvent, "id">;
          if (!data.deleted) {
            list.push({ ...(data as BabyEvent), id: d.id });
          }
        });

        // Legacy fallback: only fire when we have a SERVER-confirmed empty
        // result (not a cache miss with no cached data) and we haven't
        // tried it yet this mount. This was the runaway-reads source —
        // cache-only empties were re-triggering legacy fetches every
        // session, paying for ~320 docs each time.
        if (
          list.length === 0 &&
          !triedLegacyFallback &&
          !snap.metadata.fromCache
        ) {
          triedLegacyFallback = true;
          try {
            const legacyQ = query(
              legacyEventsCollection(),
              orderBy("occurred_at", "desc"),
              limit(maxCount),
            );
            const legacySnap = await getDocs(legacyQ);
            if (cancelled) return;
            if (!legacySnap.empty) {
              const legacyList: BabyEvent[] = [];
              legacySnap.forEach((d) => {
                const data = d.data() as Omit<BabyEvent, "id">;
                if (!data.deleted) {
                  legacyList.push({ ...(data as BabyEvent), id: d.id });
                }
              });
              setEvents(legacyList);
              setSource("legacy");
              setLoading(false);
              return;
            }
          } catch {
            /* legacy may be denied — fine */
          }
        }

        setEvents(list);
        setSource("new");
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [hid, maxCount]);

  return { events, loading, error, source };
}

export type NewEventPayload =
  | { type: "breast_feed"; outcome: BreastFeedOutcome; side: Side }
  | { type: "bottle_feed"; volume_ml: number; milk_types: MilkType[] }
  | { type: "pump"; volume_ml: number; side: Side }
  | { type: "diaper_wet" }
  | { type: "diaper_dirty" }
  | { type: "diaper_mixed" }
  | { type: "sleep_start" }
  | { type: "sleep_end" }
  | { type: "weight"; weight_grams: number; notes?: string }
  | {
      type: "book_read";
      title: string;
      author?: string;
      cover_url?: string;
      open_library_key?: string;
    }
  | {
      type: "food_tried";
      food_name: string;
      reaction?: FoodReaction;
      first_try?: boolean;
      notes?: string;
    }
  | {
      type: "medication";
      name: string;
      dose?: string;
      notes?: string;
    }
  | {
      type: "temperature";
      temp_f: number;
      method?: TempMethod;
      notes?: string;
    };

export async function writeEvent(
  payload: NewEventPayload,
  occurredAt?: Date,
  currentEvents?: BabyEvent[],
): Promise<string> {
  const hid = requireHouseholdId();
  const auth = getFirebaseAuth();
  const user = auth.currentUser!;
  const now = occurredAt ?? new Date();
  const nowTs = Timestamp.fromDate(now);
  const eventBase = {
    ...payload,
    occurred_at: nowTs,
    created_by: user.uid,
    created_by_email: user.email ?? null,
    created_at: nowTs,
    deleted: false,
  };

  if (!SUMMARIES_ENABLED) {
    const ref = await addDoc(eventsCollection(hid), eventBase);
    return ref.id;
  }
  return writeEventWithSummary(hid, eventBase, payload, now, currentEvents);
}

export async function softDeleteEvent(
  id: string,
  currentEvents?: BabyEvent[],
): Promise<void> {
  const hid = requireHouseholdId();
  if (!SUMMARIES_ENABLED) {
    await updateDoc(eventDoc(hid, id), {
      deleted: true,
      updated_at: Timestamp.now(),
    });
    return;
  }
  await deleteEventWithSummary(hid, id, currentEvents);
}

// ---- Dual-write internals (only reached when SUMMARIES_ENABLED) ----

async function writeEventWithSummary(
  hid: string,
  eventBase: Record<string, unknown>,
  payload: NewEventPayload,
  occurredAt: Date,
  currentEvents?: BabyEvent[],
): Promise<string> {
  const newRef = doc(eventsCollection(hid));

  // Sleep_end: needs a transaction to find the matching open sleep_start
  // and split the resulting window across day boundaries.
  if (payload.type === "sleep_end") {
    return writeSleepEndWithSummary(
      hid,
      newRef,
      eventBase,
      occurredAt,
      currentEvents,
    );
  }

  // Temperature: needs a transaction to read current max and compare.
  if (payload.type === "temperature") {
    return writeTemperatureWithSummary(
      hid,
      newRef,
      eventBase,
      payload,
      occurredAt,
      currentEvents,
    );
  }

  // Pure-counter case: writeBatch + FieldValue.increment is atomic and
  // avoids the read cost a transaction would incur.
  const delta = deltaForEvent({ type: payload.type, ...(payload as object) });
  const batch = writeBatch(getDb());
  batch.set(newRef, eventBase);
  if (delta) {
    const dayKey = dayKeyOf(occurredAt);
    batch.set(
      summaryDoc(hid, dayKey),
      { dayKey, ...deltaToIncrements(delta), updated_at: Timestamp.now() },
      { merge: true },
    );
  }
  if (VIEWS_ENABLED) {
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "insert",
      event: { ...(eventBase as object), id: newRef.id } as BabyEvent,
    });
  }
  await batch.commit();
  return newRef.id;
}

async function writeSleepEndWithSummary(
  hid: string,
  newRef: ReturnType<typeof doc>,
  eventBase: Record<string, unknown>,
  occurredAt: Date,
  currentEvents?: BabyEvent[],
): Promise<string> {
  // Find the matching open sleep_start: most recent sleep_start with no
  // sleep_end after it. Read just enough recent events to pair them.
  const recentQ = query(
    eventsCollection(hid),
    orderBy("occurred_at", "desc"),
    limit(50),
  );
  const recent = await getDocs(recentQ);
  let openStartAt: Date | null = null;
  // Walk newest-first; first sleep_end means our search target is older
  // than that and unrelated.
  for (const d of recent.docs) {
    const data = d.data() as { type: string; deleted?: boolean; occurred_at: Timestamp };
    if (data.deleted) continue;
    if (data.type === "sleep_end") break;
    if (data.type === "sleep_start") {
      openStartAt = data.occurred_at.toDate();
      break;
    }
  }

  const batch = writeBatch(getDb());
  let minutesByDay: Record<string, number> = {};
  if (openStartAt && occurredAt > openStartAt) {
    minutesByDay = splitSleepMinutes(openStartAt, occurredAt);
    for (const [dk, mins] of Object.entries(minutesByDay)) {
      batch.set(
        summaryDoc(hid, dk),
        {
          dayKey: dk,
          sleepMinutes: increment(mins),
          updated_at: Timestamp.now(),
        },
        { merge: true },
      );
    }
  }
  const sleepEndEventDoc = {
    ...eventBase,
    sleep_minutes_by_day: minutesByDay,
  };
  batch.set(newRef, sleepEndEventDoc);
  if (VIEWS_ENABLED) {
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "insert",
      event: { ...sleepEndEventDoc, id: newRef.id } as unknown as BabyEvent,
    });
  }
  await batch.commit();
  return newRef.id;
}

async function writeTemperatureWithSummary(
  hid: string,
  newRef: ReturnType<typeof doc>,
  eventBase: Record<string, unknown>,
  payload: Extract<NewEventPayload, { type: "temperature" }>,
  occurredAt: Date,
  currentEvents?: BabyEvent[],
): Promise<string> {
  const dayKey = dayKeyOf(occurredAt);
  const ref = summaryDoc(hid, dayKey);
  await runTransaction(getDb(), async (tx) => {
    // All reads must happen before all writes inside a transaction.
    const snap = await tx.get(ref);
    const homeSnap = VIEWS_ENABLED ? await tx.get(homeViewDoc(hid)) : null;
    const libSnap = VIEWS_ENABLED ? await tx.get(libraryViewDoc(hid)) : null;
    const cur = snap.exists() ? (snap.data() as { maxTempF?: number | null }) : null;
    const newMax =
      cur?.maxTempF == null || payload.temp_f > cur.maxTempF
        ? payload.temp_f
        : cur.maxTempF;
    tx.set(
      ref,
      { dayKey, maxTempF: newMax, updated_at: Timestamp.now() },
      { merge: true },
    );
    tx.set(newRef, eventBase);
    if (VIEWS_ENABLED && homeSnap && libSnap) {
      const existingHome = homeSnap.exists()
        ? (homeSnap.data() as HomeView)
        : null;
      const existingLib: LibraryView = libSnap.exists()
        ? (libSnap.data() as LibraryView)
        : { books: [], foods: [] };
      const existingRecent = existingHome?.recent_events ?? [];
      const byId = new Map<string, BabyEvent>();
      for (const e of existingRecent) byId.set(e.id, e);
      for (const e of currentEvents ?? []) byId.set(e.id, e);
      const change: ViewChange = {
        kind: "insert",
        event: { ...eventBase, id: newRef.id } as BabyEvent,
      };
      const projected = applyEventChange(Array.from(byId.values()), change);
      const now = new Date();
      const home = computeHomeView(projected, now);
      home.latest = preserveLatestPointers(
        home.latest,
        existingHome?.latest,
        change,
      );
      tx.set(homeViewDoc(hid), { ...home, updated_at: Timestamp.now() });
      tx.set(insightsViewDoc(hid), {
        ...computeInsightsView(projected, now),
        updated_at: Timestamp.now(),
      });
      tx.set(libraryViewDoc(hid), {
        ...applyChangeToLibraryView(existingLib, change),
        updated_at: Timestamp.now(),
      });
    }
  });
  return newRef.id;
}

async function deleteEventWithSummary(
  hid: string,
  id: string,
  currentEvents?: BabyEvent[],
): Promise<void> {
  const ref = eventDoc(hid, id);
  const snap = await getDocs(
    query(eventsCollection(hid), where("__name__", "==", id), limit(1)),
  );
  // The query above is more permissive of cache hits than getDoc, but a
  // direct getDoc would also work. Use the result we have.
  const data = snap.empty
    ? null
    : (snap.docs[0]!.data() as Record<string, unknown> & {
        type: string;
        occurred_at: Timestamp;
        deleted?: boolean;
        sleep_minutes_by_day?: Record<string, number>;
        temp_f?: number;
        volume_ml?: number;
      });
  if (!data || data.deleted) {
    // Already deleted or missing — just mark and bail.
    await updateDoc(ref, { deleted: true, updated_at: Timestamp.now() });
    return;
  }

  const occurredAt = data.occurred_at.toDate();
  const dayKey = dayKeyOf(occurredAt);

  // Sleep_end: invert the stored per-day minute map.
  if (data.type === "sleep_end") {
    const map = data.sleep_minutes_by_day ?? {};
    const batch = writeBatch(getDb());
    for (const [dk, mins] of Object.entries(map)) {
      batch.set(
        summaryDoc(hid, dk),
        {
          dayKey: dk,
          sleepMinutes: increment(-mins),
          updated_at: Timestamp.now(),
        },
        { merge: true },
      );
    }
    batch.update(ref, { deleted: true, updated_at: Timestamp.now() });
    if (VIEWS_ENABLED) {
      await stageViewWrites(batch, hid, currentEvents, {
        kind: "delete",
        eventId: id,
      });
    }
    await batch.commit();
    return;
  }

  // Temperature: max isn't directly invertible. Recompute from the day's
  // remaining temp events.
  if (data.type === "temperature") {
    const dayStart = new Date(
      occurredAt.getFullYear(),
      occurredAt.getMonth(),
      occurredAt.getDate(),
    );
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const tempQ = query(
      eventsCollection(hid),
      where("type", "==", "temperature"),
      where("occurred_at", ">=", Timestamp.fromDate(dayStart)),
      where("occurred_at", "<", Timestamp.fromDate(dayEnd)),
    );
    const tempSnap = await getDocs(tempQ);
    let newMax: number | null = null;
    for (const d of tempSnap.docs) {
      if (d.id === id) continue;
      const td = d.data() as { temp_f?: number; deleted?: boolean };
      if (td.deleted) continue;
      if (typeof td.temp_f === "number") {
        if (newMax === null || td.temp_f > newMax) newMax = td.temp_f;
      }
    }
    const batch = writeBatch(getDb());
    batch.set(
      summaryDoc(hid, dayKey),
      { dayKey, maxTempF: newMax, updated_at: Timestamp.now() },
      { merge: true },
    );
    batch.update(ref, { deleted: true, updated_at: Timestamp.now() });
    if (VIEWS_ENABLED) {
      await stageViewWrites(batch, hid, currentEvents, {
        kind: "delete",
        eventId: id,
      });
    }
    await batch.commit();
    return;
  }

  // Pure-counter case: invert the original delta.
  const delta = deltaForEvent({
    type: data.type as never,
    volume_ml: data.volume_ml,
  });
  const batch = writeBatch(getDb());
  if (delta) {
    batch.set(
      summaryDoc(hid, dayKey),
      {
        dayKey,
        ...deltaToIncrements(inverseDelta(delta)),
        updated_at: Timestamp.now(),
      },
      { merge: true },
    );
  }
  batch.update(ref, { deleted: true, updated_at: Timestamp.now() });
  if (VIEWS_ENABLED) {
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "delete",
      eventId: id,
    });
  }
  await batch.commit();
}

// One-shot fetch of events in a specific [startDate, endDate) window. Used by
// Timeline/Trends when the user picks a range wider than the live-listener
// baseline, so we only pay reads for the older slice on demand.
export async function fetchEventsInRange(
  startDate: Date,
  endDate: Date,
  maxCount = 2000,
): Promise<BabyEvent[]> {
  const hid = requireHouseholdId();
  const q = query(
    eventsCollection(hid),
    where("occurred_at", ">=", Timestamp.fromDate(startDate)),
    where("occurred_at", "<", Timestamp.fromDate(endDate)),
    orderBy("occurred_at", "desc"),
    limit(maxCount),
  );
  const snap = await getDocs(q);
  const list: BabyEvent[] = [];
  snap.forEach((d) => {
    const data = d.data() as Omit<BabyEvent, "id">;
    if (!data.deleted) list.push({ ...(data as BabyEvent), id: d.id });
  });
  return list;
}

// Given the set of "live" events (count-limited listener feed) and a requested
// range in days, extend with a one-shot fetch of the older slice if needed.
// Coverage is derived from the actual oldest live event, not a hardcoded
// liveDays assumption — so this still works correctly with a limit-only
// listener whose coverage varies with event volume.
//
// The returned list is newest-first and deduped by id.
export function useExtendedEvents(
  liveEvents: BabyEvent[],
  days: number,
): { events: BabyEvent[]; loadingMore: boolean } {
  const [older, setOlder] = useState<BabyEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Round the live coverage and requested range to day boundaries so the
  // effect doesn't re-fire every render due to Date.now() jitter.
  const oldestLiveDay =
    liveEvents.length > 0
      ? Math.floor(
          liveEvents[liveEvents.length - 1]!.occurred_at.toMillis() / 86400000,
        )
      : Math.floor(Date.now() / 86400000);
  const requestedStartDay =
    Math.floor(Date.now() / 86400000) - days;

  useEffect(() => {
    if (oldestLiveDay <= requestedStartDay) {
      setOlder([]);
      return;
    }
    let cancelled = false;
    const windowEnd = new Date(oldestLiveDay * 86400000);
    const windowStart = new Date(requestedStartDay * 86400000);
    setLoadingMore(true);
    fetchEventsInRange(windowStart, windowEnd)
      .then((events) => {
        if (!cancelled) {
          setOlder(events);
          setLoadingMore(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [oldestLiveDay, requestedStartDay]);

  // Merge live + older, deduping on id. Live wins on conflict so a live
  // edit is preferred over the older snapshot.
  const byId = new Map<string, BabyEvent>();
  for (const e of older) byId.set(e.id, e);
  for (const e of liveEvents) byId.set(e.id, e);
  const merged = Array.from(byId.values()).sort(
    (a, b) => b.occurred_at.toMillis() - a.occurred_at.toMillis(),
  );
  return { events: merged, loadingMore };
}

// Live listener for events of a specific type. Used for sparse types
// (weights, books, foods, medications) that would be crowded out of the
// main count-limited listener by frequent feeds/diapers/sleep.
//
// The query is stable — type is a literal, limit is fixed, and ordering is
// deterministic. So persistent cache + resume tokens reuse the listen
// across mounts and only changed docs are billed.
export function useEventsByType<T extends BabyEvent["type"]>(
  type: T,
  maxCount = 200,
): Extract<BabyEvent, { type: T }>[] {
  const hid = useHouseholdId();
  const [items, setItems] = useState<Extract<BabyEvent, { type: T }>[]>([]);

  useEffect(() => {
    if (!hid) return;
    // Caller can pass maxCount=0 to opt out entirely (e.g. when reading
    // the same data from a materialized view doc instead).
    if (maxCount <= 0) return;
    const q = query(
      eventsCollection(hid),
      where("type", "==", type),
      orderBy("occurred_at", "desc"),
      limit(maxCount),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: Extract<BabyEvent, { type: T }>[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<BabyEvent, "id">;
        if (!data.deleted) {
          list.push({
            ...(data as Extract<BabyEvent, { type: T }>),
            id: d.id,
          });
        }
      });
      setItems(list);
    });
    return unsub;
  }, [hid, type, maxCount]);

  return items;
}

// Backward-compatible thin wrapper. Pass enabled=false to skip the
// underlying listener attachment entirely (used when the caller is
// reading weights from the materialized insights view doc instead).
export function useAllWeights(enabled = true): BabyEvent[] {
  return useEventsByType("weight", enabled ? 200 : 0);
}

// Live listener over a [today - days + 1, today] range of daily summary
// docs. Returns an array of N entries (oldest first) padded with empty
// summaries for days that have no doc yet. Charts read from this to avoid
// pulling raw events.
//
// Only attaches when SUMMARIES_ENABLED is true. Call sites should fall
// back to raw-event bucketing when the flag is off.
export function useDailySummariesRange(
  days: number,
): { summaries: DailySummary[]; loading: boolean } {
  const hid = useHouseholdId();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const todayKey = dayKeyOf(new Date());

  useEffect(() => {
    if (!SUMMARIES_ENABLED || !hid) {
      setSummaries([]);
      setLoading(false);
      return;
    }
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    const startKey = dayKeyOf(start);

    const col = collection(getDb(), "households", hid, "daily_summaries");
    const q = query(
      col,
      where("__name__", ">=", startKey),
      where("__name__", "<=", todayKey),
    );
    const unsub = onSnapshot(q, (snap) => {
      const byKey = new Map<string, DailySummary>();
      snap.forEach((d) => {
        const raw = d.data() as Partial<DailySummary>;
        // Incremental dual-writes only set the fields they touched; coerce
        // missing fields to safe defaults so downstream consumers don't see
        // undefined.
        byKey.set(d.id, {
          dayKey: d.id,
          feeds: raw.feeds ?? 0,
          breast_feeds: raw.breast_feeds ?? 0,
          bottle_feeds: raw.bottle_feeds ?? 0,
          pump_count: raw.pump_count ?? 0,
          milkMl: raw.milkMl ?? 0,
          pumpMl: raw.pumpMl ?? 0,
          diapers: raw.diapers ?? 0,
          wets: raw.wets ?? 0,
          dirties: raw.dirties ?? 0,
          mixeds: raw.mixeds ?? 0,
          meds: raw.meds ?? 0,
          sleepMinutes: raw.sleepMinutes ?? 0,
          maxTempF: raw.maxTempF ?? null,
        });
      });
      const out: DailySummary[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const k = dayKeyOf(d);
        out.push(
          byKey.get(k) ?? {
            dayKey: k,
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
          },
        );
      }
      setSummaries(out);
      setLoading(false);
    });
    return unsub;
  }, [hid, days, todayKey]);

  return { summaries, loading };
}

export const SUMMARIES_FLAG_ENABLED = SUMMARIES_ENABLED;
export const VIEWS_FLAG_ENABLED = VIEWS_ENABLED;

// Live listener on the home view doc. Returns null until the first snapshot.
// One Firestore read per cold cache attach (or 0 with a valid resume token);
// one read per real-time change. The whole home page renders from this.
export function useHomeView(): {
  view: HomeView | null;
  loading: boolean;
} {
  const hid = useHouseholdId();
  const [view, setView] = useState<HomeView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!VIEWS_ENABLED || !hid) {
      setLoading(false);
      return;
    }
    const ref = homeViewDoc(hid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setView(snap.data() as HomeView);
      } else {
        setView(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [hid]);

  return { view, loading };
}

export function useInsightsView(): {
  view: InsightsView | null;
  loading: boolean;
} {
  const hid = useHouseholdId();
  const [view, setView] = useState<InsightsView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!VIEWS_ENABLED || !hid) {
      setLoading(false);
      return;
    }
    const ref = insightsViewDoc(hid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setView(snap.data() as InsightsView);
      } else {
        setView(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [hid]);

  return { view, loading };
}

export function useLibraryView(): {
  view: LibraryView | null;
  loading: boolean;
} {
  const hid = useHouseholdId();
  const [view, setView] = useState<LibraryView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!VIEWS_ENABLED || !hid) {
      setLoading(false);
      return;
    }
    const ref = libraryViewDoc(hid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setView(snap.data() as LibraryView);
      } else {
        setView(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [hid]);

  return { view, loading };
}

export async function fetchAllEvents(): Promise<BabyEvent[]> {
  const hid = requireHouseholdId();
  const q = query(
    eventsCollection(hid),
    orderBy("occurred_at", "desc"),
  );
  const snap = await getDocs(q);
  const list: BabyEvent[] = [];
  snap.forEach((d) => {
    const data = d.data() as Omit<BabyEvent, "id">;
    if (!data.deleted) list.push({ ...(data as BabyEvent), id: d.id });
  });
  return list;
}

export async function updateEvent(
  id: string,
  patch: Partial<NewEventPayload> & { occurred_at?: Date },
  currentEvents?: BabyEvent[],
): Promise<void> {
  const hid = requireHouseholdId();
  const { occurred_at, ...rest } = patch;
  const update: Record<string, unknown> = {
    ...rest,
    updated_at: Timestamp.now(),
  };
  if (occurred_at) update.occurred_at = Timestamp.fromDate(occurred_at);

  if (!SUMMARIES_ENABLED) {
    await updateDoc(eventDoc(hid, id), update);
    return;
  }
  await updateEventWithSummary(hid, id, patch, update, currentEvents);
}

async function updateEventWithSummary(
  hid: string,
  id: string,
  patch: Partial<NewEventPayload> & { occurred_at?: Date },
  flatUpdate: Record<string, unknown>,
  currentEvents?: BabyEvent[],
): Promise<void> {
  const ref = eventDoc(hid, id);

  // Read the existing event up front (one read). For pure-counter and
  // sleep_end cases we then build a writeBatch; temperature recomputes
  // max via an additional query.
  const existingSnap = await getDocs(
    query(eventsCollection(hid), where("__name__", "==", id), limit(1)),
  );
  if (existingSnap.empty) {
    // Fallback: just apply the update and skip summary side-effects.
    await updateDoc(ref, flatUpdate);
    return;
  }
  const old = existingSnap.docs[0]!.data() as Record<string, unknown> & {
    type: string;
    occurred_at: Timestamp;
    deleted?: boolean;
    sleep_minutes_by_day?: Record<string, number>;
    temp_f?: number;
    volume_ml?: number;
  };
  if (old.deleted) {
    await updateDoc(ref, flatUpdate);
    return;
  }

  const oldOccurredAt = old.occurred_at.toDate();
  const newOccurredAt = patch.occurred_at ?? oldOccurredAt;
  const newType = (patch.type ?? old.type) as string;

  // Sleep_end edits: invert old minute map, recompute new window using the
  // most recent open sleep_start, write new map onto the event.
  if (newType === "sleep_end" && old.type === "sleep_end") {
    const oldMap = old.sleep_minutes_by_day ?? {};
    const recentQ = query(
      eventsCollection(hid),
      orderBy("occurred_at", "desc"),
      limit(50),
    );
    const recent = await getDocs(recentQ);
    let openStartAt: Date | null = null;
    for (const d of recent.docs) {
      if (d.id === id) continue;
      const data = d.data() as { type: string; deleted?: boolean; occurred_at: Timestamp };
      if (data.deleted) continue;
      if (data.type === "sleep_end") break;
      if (data.type === "sleep_start") {
        openStartAt = data.occurred_at.toDate();
        break;
      }
    }
    const newMap: Record<string, number> =
      openStartAt && newOccurredAt > openStartAt
        ? splitSleepMinutes(openStartAt, newOccurredAt)
        : {};
    const batch = writeBatch(getDb());
    for (const [dk, mins] of Object.entries(oldMap)) {
      batch.set(
        summaryDoc(hid, dk),
        { dayKey: dk, sleepMinutes: increment(-mins), updated_at: Timestamp.now() },
        { merge: true },
      );
    }
    for (const [dk, mins] of Object.entries(newMap)) {
      batch.set(
        summaryDoc(hid, dk),
        { dayKey: dk, sleepMinutes: increment(mins), updated_at: Timestamp.now() },
        { merge: true },
      );
    }
    batch.update(ref, { ...flatUpdate, sleep_minutes_by_day: newMap });
    if (VIEWS_ENABLED) {
      const updated = projectUpdatedEvent(old, id, flatUpdate, {
        sleep_minutes_by_day: newMap,
      });
      await stageViewWrites(batch, hid, currentEvents, {
        kind: "replace",
        event: updated,
      });
    }
    await batch.commit();
    return;
  }

  // Temperature edits: recompute max for affected days from the day's
  // temperature events. Touch both old day and new day if occurred_at
  // moved across midnight.
  if (newType === "temperature" || old.type === "temperature") {
    const oldDayKey = dayKeyOf(oldOccurredAt);
    const newDayKey = dayKeyOf(newOccurredAt);
    // Apply the patch first (so the recompute query sees the updated row).
    await updateDoc(ref, flatUpdate);
    const daysToRecompute = oldDayKey === newDayKey ? [oldDayKey] : [oldDayKey, newDayKey];
    const batch = writeBatch(getDb());
    for (const dk of daysToRecompute) {
      const dayStart = parseDayKey(dk);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const tempQ = query(
        eventsCollection(hid),
        where("type", "==", "temperature"),
        where("occurred_at", ">=", Timestamp.fromDate(dayStart)),
        where("occurred_at", "<", Timestamp.fromDate(dayEnd)),
      );
      const tempSnap = await getDocs(tempQ);
      let max: number | null = null;
      for (const d of tempSnap.docs) {
        const td = d.data() as { temp_f?: number; deleted?: boolean };
        if (td.deleted) continue;
        if (typeof td.temp_f === "number") {
          if (max === null || td.temp_f > max) max = td.temp_f;
        }
      }
      batch.set(
        summaryDoc(hid, dk),
        { dayKey: dk, maxTempF: max, updated_at: Timestamp.now() },
        { merge: true },
      );
    }
    if (VIEWS_ENABLED) {
      const updated = projectUpdatedEvent(old, id, flatUpdate);
      await stageViewWrites(batch, hid, currentEvents, {
        kind: "replace",
        event: updated,
      });
    }
    await batch.commit();
    return;
  }

  // Pure-counter case: invert old delta on old day, apply new delta on
  // new day. Same day collapses to (new - old) net.
  const oldDelta = deltaForEvent({
    type: old.type as never,
    volume_ml: old.volume_ml,
  });
  const newVolumeMl =
    "volume_ml" in patch && typeof patch.volume_ml === "number"
      ? patch.volume_ml
      : old.volume_ml;
  const newDelta = deltaForEvent({
    type: newType as never,
    volume_ml: newVolumeMl,
  });
  const oldDayKey = dayKeyOf(oldOccurredAt);
  const newDayKey = dayKeyOf(newOccurredAt);
  const batch = writeBatch(getDb());
  if (oldDelta) {
    batch.set(
      summaryDoc(hid, oldDayKey),
      {
        dayKey: oldDayKey,
        ...deltaToIncrements(inverseDelta(oldDelta)),
        updated_at: Timestamp.now(),
      },
      { merge: true },
    );
  }
  if (newDelta) {
    batch.set(
      summaryDoc(hid, newDayKey),
      {
        dayKey: newDayKey,
        ...deltaToIncrements(newDelta),
        updated_at: Timestamp.now(),
      },
      { merge: true },
    );
  }
  batch.update(ref, flatUpdate);
  if (VIEWS_ENABLED) {
    const updated = projectUpdatedEvent(old, id, flatUpdate);
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "replace",
      event: updated,
    });
  }
  await batch.commit();
}

// "YYYY-MM-DD" → midnight Date in local time.
function parseDayKey(dk: string): Date {
  const [y, m, d] = dk.split("-").map((n) => parseInt(n, 10));
  return new Date(y!, m! - 1, d!);
}

// Apply a flat field update to an existing event doc (admin-shape data
// loaded from Firestore) and return a BabyEvent-shaped object suitable for
// passing to the view compute functions. flatUpdate may contain Timestamps
// (occurred_at) or scalars; we copy them across without conversion.
function projectUpdatedEvent(
  old: Record<string, unknown> & { occurred_at: Timestamp; type: string },
  id: string,
  flatUpdate: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): BabyEvent {
  return {
    ...(old as object),
    ...flatUpdate,
    ...extra,
    id,
  } as BabyEvent;
}
