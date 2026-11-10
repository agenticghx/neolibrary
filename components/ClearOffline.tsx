"use client";

import { useEffect } from "react";
import { clearOffline } from "@/lib/offline";

/** On pages shown to someone not signed in: books downloaded for offline do not stay on the device. */
export function ClearOffline() {
  useEffect(() => {
    void clearOffline().catch(() => {});
  }, []);
  return null;
}
