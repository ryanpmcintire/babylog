"use client";

import { useMemo } from "react";
import { useAuth } from "@/app/providers";
import { getBabyForEmail, type BabyProfile } from "./baby";

export function useBaby(): BabyProfile {
  const { user } = useAuth();
  return useMemo(
    () => getBabyForEmail(user?.email ?? null),
    [user?.email],
  );
}
