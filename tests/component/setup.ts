// Vitest setup for component tests. Provides jsdom + Testing Library
// matchers and global mocks for the @/lib modules that touch Firebase.
//
// The goal of this suite is *not* to test Firestore behavior (the
// dualwrite emulator suite covers that). It's to catch prop-drilling
// regressions in React components — specifically, that interactive
// elements actually wire up to writeEvent / updateEvent / softDeleteEvent
// with the expected arguments. Tests assert on calls to those mocked
// functions; the real Firebase SDK is never loaded.

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Spy implementations for the imperative event API. Tests reset and
// inspect them via the exported helpers below. Typed with the same
// signatures as the production functions so mock.calls indexes are
// type-safe in test assertions.
import type { writeEvent, updateEvent, softDeleteEvent } from "@/lib/useEvents";
export const mockWriteEvent = vi.fn<typeof writeEvent>(async () => "mock-event-id");
export const mockUpdateEvent = vi.fn<typeof updateEvent>(async () => undefined);
export const mockSoftDeleteEvent = vi.fn<typeof softDeleteEvent>(
  async () => undefined,
);

// View hooks default to returning null (loading state). Tests can
// override with mockUseHomeView.mockReturnValue(...) etc. Typed to
// accept any view shape so test setups don't have to fight TS.
import type { HomeView, InsightsView, LibraryView } from "@/lib/views";
type ViewHookReturn<T> = { view: T | null; loading: boolean };
export const mockUseHomeView = vi.fn<() => ViewHookReturn<HomeView>>(() => ({
  view: null,
  loading: true,
}));
export const mockUseInsightsView = vi.fn<() => ViewHookReturn<InsightsView>>(
  () => ({ view: null, loading: true }),
);
export const mockUseLibraryView = vi.fn<() => ViewHookReturn<LibraryView>>(
  () => ({ view: null, loading: true }),
);

vi.mock("@/lib/firebase", () => ({
  getDb: vi.fn(() => ({})),
  getFirebaseAuth: vi.fn(() => ({
    currentUser: { uid: "test-uid", email: "test@example.com" },
  })),
  __setTestFirebase: vi.fn(),
}));

vi.mock("@/lib/useEvents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/useEvents")>(
    "@/lib/useEvents",
  );
  return {
    ...actual,
    writeEvent: mockWriteEvent,
    updateEvent: mockUpdateEvent,
    softDeleteEvent: mockSoftDeleteEvent,
    useHomeView: mockUseHomeView,
    useInsightsView: mockUseInsightsView,
    useLibraryView: mockUseLibraryView,
    useRecentEvents: vi.fn(() => ({
      events: [],
      loading: false,
      error: null,
      source: "new" as const,
    })),
    useEventsByType: vi.fn(() => []),
    useAllWeights: vi.fn(() => []),
    useExtendedEvents: vi.fn(() => ({ events: [], loadingMore: false })),
    useDailySummariesRange: vi.fn(() => ({ summaries: [], loading: false })),
    fetchEventsInRange: vi.fn(async () => []),
    fetchAllEvents: vi.fn(async () => []),
    VIEWS_FLAG_ENABLED: true,
    SUMMARIES_FLAG_ENABLED: true,
  };
});

vi.mock("@/app/providers", () => ({
  useAuth: () => ({
    user: { uid: "test-uid", email: "test@example.com" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// Most components call useBaby for the baby's birthdate. Stub it.
vi.mock("@/lib/useBaby", () => ({
  useBaby: () => ({
    id: "mcintire",
    name: "Lily",
    fullName: "Lily Patricia McIntire",
    birthdate: new Date("2026-04-09"),
  }),
}));

vi.mock("@/lib/prefs", () => ({
  useBoolPref: () => [false, vi.fn()],
}));

// HomeClient composition tests need rhythm + funAge — stub them.
vi.mock("@/lib/rhythm", () => ({
  rhythmClassFor: () => "",
  useFunAgeMode: () => "off",
  readFunAgeMode: () => null,
  writeFunAgeMode: vi.fn(),
}));

// Reset spies + localStorage between tests so call counts and the
// last-active-tab persistence don't leak across tests.
import { afterEach, beforeEach } from "vitest";
beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
afterEach(() => {
  mockWriteEvent.mockClear();
  mockUpdateEvent.mockClear();
  mockSoftDeleteEvent.mockClear();
  mockUseHomeView.mockReturnValue({ view: null, loading: true });
  mockUseInsightsView.mockReturnValue({ view: null, loading: true });
  mockUseLibraryView.mockReturnValue({ view: null, loading: true });
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
