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

export function useRecentEvents(
  days = 7,
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
    const windowStart = Timestamp.fromMillis(
      Date.now() - days * 24 * 60 * 60 * 1000,
    );
    const q = query(
      eventsCollection(hid),
      where("occurred_at", ">=", windowStart),
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

        // Empty-on-first-sync fallback: if the new path has nothing, peek at
        // the legacy top-level collection. Catches a missed/partial migration
        // without silently showing an empty history.
        if (list.length === 0 && source === null) {
          try {
            const legacyQ = query(
              legacyEventsCollection(),
              where("occurred_at", ">=", windowStart),
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
            // Legacy read may be denied by rules post-cleanup — fine, fall
            // through to the empty new-path result.
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
    // source intentionally omitted — fallback is one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, maxCount, days]);

  return { events, loading, error, source };
}

export type NewEventPayload =
  | { type: "breast_feed"; outcome: BreastFeedOutcome; side: Side }
  | { type: "bottle_feed"; volume_ml: number; milk_types: MilkType[] }
  | { type: "pump"; volume_ml: number; side: Side }
  | { type: "diaper_wet" }
  | { type: "diaper_dirty" }
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

// Given a set of "live" events (the 7-day listener feed) and a requested
// range in days, extend with a one-shot fetch of the older slice if needed.
// The returned list is newest-first and deduped by id.
export function useExtendedEvents(
  liveEvents: BabyEvent[],
  days: number,
  liveDays = 7,
): { events: BabyEvent[]; loadingMore: boolean } {
  const [older, setOlder] = useState<BabyEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (days <= liveDays) {
      setOlder([]);
      return;
    }
    let cancelled = false;
    const now = new Date();
    const windowEnd = new Date(now.getTime() - liveDays * 86400000);
    const windowStart = new Date(now.getTime() - days * 86400000);
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
  }, [days, liveDays]);

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

// Live listener for just weight events. Weights are sparse (~1/week) and
// shown on a chart that spans the baby's whole life, so they need their own
// narrow query instead of riding the 7-day main feed.
export function useAllWeights(): BabyEvent[] {
  const hid = useHouseholdId();
  const [weights, setWeights] = useState<BabyEvent[]>([]);

  useEffect(() => {
    if (!hid) return;
    const q = query(
      eventsCollection(hid),
      where("type", "==", "weight"),
      orderBy("occurred_at", "desc"),
      limit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: BabyEvent[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<BabyEvent, "id">;
        if (!data.deleted) list.push({ ...(data as BabyEvent), id: d.id });
      });
      setWeights(list);
    });
    return unsub;
  }, [hid]);

  return weights;
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
