"use client";

import { useMemo } from "react";
import { useAuth } from "@/app/providers";
import { getHouseholdIdForEmail } from "./household";

export function useHouseholdId(): string | null {
  const { user, loading } = useAuth();
  return useMemo(() => {
    if (loading) return null;
    return getHouseholdIdForEmail(user?.email ?? null);
  }, [user?.email, loading]);
}
