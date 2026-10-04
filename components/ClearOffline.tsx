"use client";

import { useEffect } from "react";
import { clearOffline } from "@/lib/offline";

/** On the sign-in page: books downloaded for offline do not stay on the device after signing out. */
export function ClearOffline() {
  useEffect(() => {
    void clearOffline().catch(() => {});
  }, []);
  return null;
}
