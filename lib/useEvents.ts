"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
import { getHouseholdIdForEmail } from "./household";
import { useHouseholdId } from "./useHousehold";
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
// Coverage at default limit 200 is roughly 2-3 weeks at typical event rates,
// which covers Home, History, and the default Insights/Trends ranges. For
// older data, Trends/Timeline use useExtendedEvents to pull on demand.
export function useRecentEvents(
  maxCount = 500,
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
): Promise<string> {
  const hid = requireHouseholdId();
  const auth = getFirebaseAuth();
  const user = auth.currentUser!;
  const now = occurredAt ?? new Date();
  const nowTs = Timestamp.fromDate(now);

  const ref = await addDoc(eventsCollection(hid), {
    ...payload,
    occurred_at: nowTs,
    created_by: user.uid,
    created_by_email: user.email ?? null,
    created_at: nowTs,
    deleted: false,
  });
  return ref.id;
}

export async function softDeleteEvent(id: string): Promise<void> {
  const hid = requireHouseholdId();
  await updateDoc(eventDoc(hid, id), {
    deleted: true,
    updated_at: Timestamp.now(),
  });
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

// Backward-compatible thin wrapper.
export function useAllWeights(): BabyEvent[] {
  return useEventsByType("weight", 200);
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
): Promise<void> {
  const hid = requireHouseholdId();
  const { occurred_at, ...rest } = patch;
  const update: Record<string, unknown> = {
    ...rest,
    updated_at: Timestamp.now(),
  };
  if (occurred_at) update.occurred_at = Timestamp.fromDate(occurred_at);
  await updateDoc(eventDoc(hid, id), update);
}
