/*
 * M34 S4, bring your own key (docs/plan.md). The names shared by the browser and the server; nothing here may
 * import server code, because the reader's client helpers (lib/own-keys.ts) use it too.
 *
 * Samuel's keys pay only for Samuel (2026-11-02: "users have to bring their own key to use AI help and Voices.
 * users can't use mine!"). Anyone else's key stays in their own browser and is sent, over https, only with a
 * request that needs it, in one of these headers. The server uses it for that request and never stores it.
 */
export const OWN_KEY_HEADERS = { ai: "x-neolibrary-anthropic-key", voice: "x-neolibrary-elevenlabs-key" } as const;
export type OwnKeyKind = keyof typeof OWN_KEY_HEADERS;

/** Where the browser keeps each key (localStorage), on this device only. */
export const OWN_KEY_STORAGE: Record<OwnKeyKind, string> = { ai: "neolibrary:own-key:anthropic", voice: "neolibrary:own-key:elevenlabs" };

/** What a reader is told when a new answer or a voice needs their own key. */
export const OWN_KEY_NEEDED: Record<OwnKeyKind, string> = {
  ai: "Add your own Anthropic key (Reading settings, Your own keys) to ask for new answers. Answers already saved stay free.",
  voice: "Add your own ElevenLabs key (Reading settings, Your own keys) to hear an AI voice.",
};
