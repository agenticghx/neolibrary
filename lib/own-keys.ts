import { OWN_KEY_HEADERS, OWN_KEY_STORAGE, type OwnKeyKind } from "@/lib/own-key-names";

/*
 * M34 S4, in the browser: a person's own Anthropic and ElevenLabs keys, kept in this browser's localStorage and
 * nowhere else, and sent only with the requests that need them (aiFetch for AI help, voiceFetch for a voice or a
 * voice note's transcript). The library's owner needs none: the server uses the library's keys for them.
 */
export function ownKey(kind: OwnKeyKind): string | null {
  try {
    return localStorage.getItem(OWN_KEY_STORAGE[kind]) || null;
  } catch {
    return null; // storage blocked: no key
  }
}

/** Saves (or, with an empty value, removes) a key in this browser. Returns whether it is now kept. */
export function setOwnKey(kind: OwnKeyKind, value: string | null): boolean {
  try {
    const v = value?.trim();
    if (v) localStorage.setItem(OWN_KEY_STORAGE[kind], v);
    else localStorage.removeItem(OWN_KEY_STORAGE[kind]);
    return Boolean(v);
  } catch {
    return false;
  }
}

/** The request options with the key's header added, when this browser holds that key. */
export function withOwnKey(kind: OwnKeyKind, init?: RequestInit): RequestInit {
  const key = ownKey(kind);
  if (!key) return init ?? {};
  const headers = new Headers(init?.headers);
  headers.set(OWN_KEY_HEADERS[kind], key);
  return { ...init, headers };
}

/** fetch for an AI request: carries this browser's Anthropic key, if any. */
export const aiFetch = (input: string, init?: RequestInit) => fetch(input, withOwnKey("ai", init));
/** fetch for a voice request: carries this browser's ElevenLabs key, if any. */
export const voiceFetch = (input: string, init?: RequestInit) => fetch(input, withOwnKey("voice", init));
