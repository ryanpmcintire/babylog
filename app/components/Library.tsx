"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BabyEvent, FoodReaction } from "@/lib/events";
import { LILY_BIRTHDATE } from "@/lib/age";
import { searchBooks, type BookSearchResult } from "@/lib/openlibrary";
import { writeEvent, type NewEventPayload } from "@/lib/useEvents";

const FOOD_UNLOCK_DAYS = 180;

const FOOD_REACTIONS: { value: FoodReaction; label: string }[] = [
  { value: "loved", label: "Loved" },
  { value: "liked", label: "Liked" },
  { value: "neutral", label: "Neutral" },
  { value: "disliked", label: "Disliked" },
];

export function Library({ events }: { events: BabyEvent[] }) {
  const [panel, setPanel] = useState<"book" | "food" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - LILY_BIRTHDATE.getTime()) / 86400000),
  );
  const foodsUnlocked = ageDays >= FOOD_UNLOCK_DAYS;

  const { books, foods } = useMemo(() => {
    const seenBooks = new Map<
      string,
      { event: BabyEvent & { type: "book_read" }; count: number; lastAt: Date }
    >();
    const seenFoods = new Map<
      string,
      { event: BabyEvent & { type: "food_tried" }; count: number; lastAt: Date }
    >();
    for (const e of events) {
      if (e.type === "book_read") {
        const key = (e.open_library_key ?? e.title).toLowerCase();
        const at = e.occurred_at.toDate();
        const existing = seenBooks.get(key);
        if (!existing || at > existing.lastAt) {
          seenBooks.set(key, {
            event: e,
            count: (existing?.count ?? 0) + 1,
            lastAt: at,
          });
        } else {
          existing.count += 1;
        }
      } else if (e.type === "food_tried") {
        const key = e.food_name.trim().toLowerCase();
        const at = e.occurred_at.toDate();
        const existing = seenFoods.get(key);
        if (!existing || at > existing.lastAt) {
          seenFoods.set(key, {
            event: e,
            count: (existing?.count ?? 0) + 1,
            lastAt: at,
          });
        } else {
          existing.count += 1;
        }
      }
    }
    return {
      books: Array.from(seenBooks.values()).sort(
        (a, b) => b.lastAt.getTime() - a.lastAt.getTime(),
      ),
      foods: Array.from(seenFoods.values()).sort(
        (a, b) => b.lastAt.getTime() - a.lastAt.getTime(),
      ),
    };
  }, [events]);

  function onLogged(msg: string) {
    setPanel(null);
    setFlash(msg);
    setTimeout(() => setFlash(null), 2000);
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
          Library
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPanel("book")}
            className="rounded-full border border-accent-soft bg-surface px-3 py-1 text-xs font-semibold text-foreground hover:border-accent/60 hover:shadow-sm transition-all"
          >
            + Book
          </button>
          {foodsUnlocked && (
            <button
              type="button"
              onClick={() => setPanel("food")}
              className="rounded-full border border-accent-soft bg-surface px-3 py-1 text-xs font-semibold text-foreground hover:border-accent/60 hover:shadow-sm transition-all"
            >
              + Food
            </button>
          )}
        </div>
      </div>

      {flash && (
        <p className="text-center text-xs text-muted">{flash}</p>
      )}

      <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Books read</h3>
        {books.length === 0 ? (
          <p className="text-xs text-muted">
            No books yet. Tap + Book to log the first story.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-1">
            {books.map(({ event, count }) => (
              <BookCard key={event.id} event={event} count={count} />
            ))}
          </div>
        )}
      </div>

      {foodsUnlocked && (
        <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Foods tried
          </h3>
          {foods.length === 0 ? (
            <p className="text-xs text-muted">
              No foods yet. Tap + Food to log the first bite.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-accent-soft">
              {foods.map(({ event, count }) => (
                <li
                  key={event.id}
                  className="flex items-baseline justify-between py-2 gap-3"
                >
                  <span className="text-sm text-foreground truncate">
                    {event.food_name}
                  </span>
                  <span className="flex items-baseline gap-2 text-xs text-muted shrink-0">
                    {event.reaction && (
                      <span className="capitalize">{event.reaction}</span>
                    )}
                    {count > 1 && <span>×{count}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {panel === "book" && (
        <BookPanel onClose={() => setPanel(null)} onLogged={onLogged} />
      )}
      {panel === "food" && (
        <FoodPanel onClose={() => setPanel(null)} onLogged={onLogged} />
      )}
    </div>
  );
}

function BookCard({
  event,
  count,
}: {
  event: BabyEvent & { type: "book_read" };
  count: number;
}) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="flex flex-col gap-1" title={event.title}>
      <div
        className="relative rounded-lg overflow-hidden border border-accent-soft bg-background"
        style={{ aspectRatio: "2 / 3" }}
      >
        {event.cover_url && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.cover_url}
            alt={event.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-1 text-[10px] text-muted text-center">
            {event.title}
          </div>
        )}
        {count > 1 && (
          <span className="absolute top-1 right-1 rounded-full bg-accent text-white text-[9px] font-bold px-1.5 py-0.5 tabular-nums">
            ×{count}
          </span>
        )}
      </div>
      <p className="text-[10px] text-foreground leading-tight line-clamp-2">
        {event.title}
      </p>
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-surface p-5 shadow-lg flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-sm text-muted underline decoration-dotted underline-offset-4"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BookPanel({
  onClose,
  onLogged,
}: {
  onClose: () => void;
  onLogged: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      setError(null);
      searchBooks(query, ctl.signal)
        .then((r) => {
          setResults(r);
          setLoading(false);
        })
        .catch((err) => {
          if (ctl.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Search failed");
          setLoading(false);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  async function logBook(result: BookSearchResult) {
    if (logging) return;
    setLogging(true);
    try {
      const payload: NewEventPayload = {
        type: "book_read",
        title: result.title,
        ...(result.author ? { author: result.author } : {}),
        ...(result.coverUrl ? { cover_url: result.coverUrl } : {}),
        ...(result.openLibraryKey
          ? { open_library_key: result.openLibraryKey }
          : {}),
      };
      await writeEvent(payload);
      onLogged(`Logged: ${result.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setLogging(false);
    }
  }

  async function logManual() {
    const title = query.trim();
    if (!title || logging) return;
    setLogging(true);
    try {
      await writeEvent({ type: "book_read", title });
      onLogged(`Logged: ${title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setLogging(false);
    }
  }

  return (
    <Sheet title="Log a book" onClose={onClose}>
      <input
        type="text"
        autoFocus
        placeholder="Title or author"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2 max-h-[50vh]">
        {loading && (
          <p className="text-xs text-muted text-center">Searching…</p>
        )}
        {!loading && results.length > 0 && (
          <ul className="flex flex-col divide-y divide-accent-soft">
            {results.map((r) => (
              <li key={r.openLibraryKey}>
                <button
                  type="button"
                  disabled={logging}
                  onClick={() => logBook(r)}
                  className="w-full flex items-center gap-3 py-2 text-left hover:bg-background rounded-lg px-2 disabled:opacity-50"
                >
                  <div
                    className="w-10 h-14 shrink-0 rounded bg-background border border-accent-soft overflow-hidden flex items-center justify-center"
                  >
                    {r.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.coverUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[8px] text-muted">no cover</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {r.title}
                    </p>
                    {r.author && (
                      <p className="text-xs text-muted truncate">{r.author}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && query.trim() && results.length === 0 && !error && (
          <button
            type="button"
            disabled={logging}
            onClick={logManual}
            className="rounded-2xl border border-dashed border-accent-soft px-4 py-3 text-sm text-muted hover:text-foreground hover:border-accent/60"
          >
            Log &ldquo;{query.trim()}&rdquo; without a cover
          </button>
        )}
      </div>
    </Sheet>
  );
}

function FoodPanel({
  onClose,
  onLogged,
}: {
  onClose: () => void;
  onLogged: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [reaction, setReaction] = useState<FoodReaction | null>(null);
  const [firstTry, setFirstTry] = useState(false);
  const [logging, setLogging] = useState(false);

  async function confirm() {
    const food = name.trim();
    if (!food || logging) return;
    setLogging(true);
    try {
      const payload: NewEventPayload = {
        type: "food_tried",
        food_name: food,
        ...(reaction ? { reaction } : {}),
        ...(firstTry ? { first_try: true } : {}),
      };
      await writeEvent(payload);
      onLogged(`Logged: ${food}`);
    } catch {
      setLogging(false);
    }
  }

  return (
    <Sheet title="Log a food" onClose={onClose}>
      <input
        type="text"
        autoFocus
        placeholder="What did she try?"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <div>
        <p className="text-xs uppercase tracking-wider text-muted mb-2">
          Reaction
        </p>
        <div className="grid grid-cols-4 gap-2">
          {FOOD_REACTIONS.map((r) => {
            const active = reaction === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() =>
                  setReaction(active ? null : r.value)
                }
                className={
                  "min-h-[44px] rounded-xl text-xs font-semibold border transition-all " +
                  (active
                    ? "bg-accent text-white border-accent"
                    : "bg-background text-foreground border-accent-soft hover:border-accent/50")
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={firstTry}
          onChange={(e) => setFirstTry(e.target.checked)}
          className="w-4 h-4"
        />
        First time trying this
      </label>

      <button
        type="button"
        onClick={confirm}
        disabled={!name.trim() || logging}
        className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
      >
        {!name.trim() ? "Enter a food" : `Log ${name.trim()}`}
      </button>
    </Sheet>
  );
}
