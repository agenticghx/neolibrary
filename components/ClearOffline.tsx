"use client";

import { useEffect } from "react";
import { useOptionalPlayer } from "@/components/player/PlayerProvider";
import { clearOffline } from "@/lib/offline";

/** On pages shown to someone not signed in: books downloaded for offline do not stay on the device, and any reading aloud stops. */
export function ClearOffline({ clearAllKeys = false }: { clearAllKeys?: boolean }) {
  const player = useOptionalPlayer();
  useEffect(() => {
    player?.stop();
    void clearOffline(clearAllKeys).catch(() => {});
  }, [clearAllKeys, player]);
  return null;
}
