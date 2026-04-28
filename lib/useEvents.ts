"use client";

import { useEffect, useState } from "react";
import {
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
  breastSessionDelta,
  dayKeyOf,
  deltaForEvent,
  inverseDelta,
  splitSleepMinutes,
  type SummaryDelta,
} from "./summaries";
import {
  applyChangeToInsightsView,
  applyChangeToLibraryView,
  computeHomeView,
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
  

  const [homeSnap, insightsSnap, libSnap] = await Promise.all([
    getDoc(homeViewDoc(hid)),
    getDoc(insightsViewDoc(hid)),
    getDoc(libraryViewDoc(hid)),
  ]);
  const existingHome = homeSnap.exists()
    ? (homeSnap.data() as HomeView)
    : null;
  const existingInsights: InsightsView = insightsSnap.exists()
    ? (insightsSnap.data() as InsightsView)
    : { daily_summaries: [], markers: [], sleep_segments: [], weights: [] };
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

  // Insights and Library views update incrementally — preserves data
  // older than the 50-event window the dual-write has access to. Without
  // this, every event write would clobber weights/markers/sleep_segments
  // from days outside that window.
  const insights = applyChangeToInsightsView(
    existingInsights,
    change,
    projected,
    now,
  );
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

  return writeEventWithSummary(hid, eventBase, payload, now, currentEvents);
}

export async function softDeleteEvent(
  id: string,
  currentEvents?: BabyEvent[],
): Promise<void> {
  const hid = requireHouseholdId();
  await deleteEventWithSummary(hid, id, currentEvents);
}

// ---- Dual-write internals ----

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
  const dayKey = dayKeyOf(occurredAt);
  if (delta) {
    batch.set(
      summaryDoc(hid, dayKey),
      { dayKey, ...deltaToIncrements(delta), updated_at: Timestamp.now() },
      { merge: true },
    );
  }
  // Breast feeds are session-counted, not per-event. Compute the
  // session-aware delta and apply it to the summary collection too,
  // so daily_summaries.{feeds,breast_feeds} stays consistent with
  // insightsView's incremental count.
  if (payload.type === "breast_feed" && currentEvents) {
    const sessionDelta = breastSessionDelta(
      {
        kind: "insert",
        event: { ...(eventBase as object), id: newRef.id } as BabyEvent,
      },
      currentEvents,
    );
    if (sessionDelta !== 0) {
      batch.set(
        summaryDoc(hid, dayKey),
        {
          dayKey,
          feeds: increment(sessionDelta),
          breast_feeds: increment(sessionDelta),
          updated_at: Timestamp.now(),
        },
        { merge: true },
      );
    }
  }
  await stageViewWrites(batch, hid, currentEvents, {
    kind: "insert",
    event: { ...(eventBase as object), id: newRef.id } as BabyEvent,
  });
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
  // sleep_end after it. Walk currentEvents (which is the live listener's
  // newest-first array, typically 50 events). Avoids a 50-doc query that
  // used to fire on every sleep_end. Fallback to a server query only if
  // the caller didn't pass currentEvents (rare write paths).
  let openStartAt: Date | null = null;
  if (currentEvents && currentEvents.length > 0) {
    for (const e of currentEvents) {
      if (e.deleted) continue;
      if (e.type === "sleep_end") break;
      if (e.type === "sleep_start") {
        openStartAt = e.occurred_at.toDate();
        break;
      }
    }
  } else {
    const recentQ = query(
      eventsCollection(hid),
      orderBy("occurred_at", "desc"),
      limit(50),
    );
    const recent = await getDocs(recentQ);
    for (const d of recent.docs) {
      const data = d.data() as { type: string; deleted?: boolean; occurred_at: Timestamp };
      if (data.deleted) continue;
      if (data.type === "sleep_end") break;
      if (data.type === "sleep_start") {
        openStartAt = data.occurred_at.toDate();
        break;
      }
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
  await stageViewWrites(batch, hid, currentEvents, {
    kind: "insert",
    event: { ...sleepEndEventDoc, id: newRef.id } as unknown as BabyEvent,
  });
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
    const homeSnap = await tx.get(homeViewDoc(hid));
    const insightsSnap = await tx.get(insightsViewDoc(hid));
    const libSnap = await tx.get(libraryViewDoc(hid));
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
    const existingHome = homeSnap.exists()
      ? (homeSnap.data() as HomeView)
      : null;
    const existingInsights: InsightsView = insightsSnap.exists()
      ? (insightsSnap.data() as InsightsView)
      : { daily_summaries: [], markers: [], sleep_segments: [], weights: [] };
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
      ...applyChangeToInsightsView(existingInsights, change, projected, now),
      updated_at: Timestamp.now(),
    });
    tx.set(libraryViewDoc(hid), {
      ...applyChangeToLibraryView(existingLib, change),
      updated_at: Timestamp.now(),
    });
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
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "delete",
      eventId: id,
    });
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
    await stageViewWrites(batch, hid, currentEvents, {
      kind: "delete",
      eventId: id,
    });
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
  // Breast-session delete: decrement feeds/breast_feeds only if removing
  // this event empties the latched-session count for its session.
  if (data.type === "breast_feed" && currentEvents) {
    const deletedEvent = { ...data, id } as unknown as BabyEvent;
    const sessionDelta = breastSessionDelta(
      { kind: "delete", event: deletedEvent },
      currentEvents,
    );
    if (sessionDelta !== 0) {
      batch.set(
        summaryDoc(hid, dayKey),
        {
          dayKey,
          feeds: increment(sessionDelta),
          breast_feeds: increment(sessionDelta),
          updated_at: Timestamp.now(),
        },
        { merge: true },
      );
    }
  }
  batch.update(ref, { deleted: true, updated_at: Timestamp.now() });
  const deletedEvent =
    data.type === "breast_feed"
      ? ({ ...data, id } as unknown as BabyEvent)
      : undefined;
  await stageViewWrites(batch, hid, currentEvents, {
    kind: "delete",
    eventId: id,
    ...(deletedEvent ? { event: deletedEvent } : {}),
  });
  await batch.commit();
}

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
    if (!hid) {
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
    if (!hid) {
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
    if (!hid) {
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
  // most recent open sleep_start, write new map onto the event. Same
  // event-array-walk optimization as writeSleepEndWithSummary — avoids
  // a 50-doc query when the caller passed currentEvents.
  if (newType === "sleep_end" && old.type === "sleep_end") {
    const oldMap = old.sleep_minutes_by_day ?? {};
    let openStartAt: Date | null = null;
    if (currentEvents && currentEvents.length > 0) {
      for (const e of currentEvents) {
        if (e.id === id) continue;
        if (e.deleted) continue;
        if (e.type === "sleep_end") break;
        if (e.type === "sleep_start") {
          openStartAt = e.occurred_at.toDate();
          break;
        }
      }
    } else {
      const recentQ = query(
        eventsCollection(hid),
        orderBy("occurred_at", "desc"),
        limit(50),
      );
      const recent = await getDocs(recentQ);
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
    {
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
    {
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
  {
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
