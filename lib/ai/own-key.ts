import { OWN_KEY_HEADERS, type OwnKeyKind } from "@/lib/own-key-names";
import { AiNotConfigured, type TextModel, type TextRequest } from "./model";

/*
 * M34 S4: a request paid with the asker's own key. Its model's provider gets OWN_KEY_SUFFIX ("anthropic-own-key"),
 * so what it costs is saved like any answer but never counts against the owner's spending or caps (reserveSpend
 * lets an own-key provider through), and the Spending page, which sums "anthropic", leaves it out.
 */
export const OWN_KEY_SUFFIX = "-own-key";
export const isOwnKeyProvider = (provider: string) => provider.endsWith(OWN_KEY_SUFFIX);

/** The key a request carries in its header, or null. Never logged, never stored. */
export function ownKeyFrom(req: Request, kind: OwnKeyKind): string | null {
  const value = req.headers.get(OWN_KEY_HEADERS[kind])?.trim();
  // A key is one printable word; anything else is not a key and is ignored rather than echoed back.
  if (!value || value.length > 300 || !/^[\x21-\x7e]+$/.test(value)) return null;
  return value;
}

/** A text model that runs on the asker's own key. */
export class OwnKeyTextModel implements TextModel {
  readonly provider: string;
  readonly model: string;
  constructor(private readonly inner: TextModel) {
    this.provider = inner.provider + OWN_KEY_SUFFIX;
    this.model = inner.model;
  }
  generate(req: TextRequest) {
    return this.inner.generate(req);
  }
}

/**
 * Stands in for a model when the asker has no key: a saved answer is still served (the generator looks for one
 * before it calls the model), and only a new one is refused, with how to add a key. Its provider is an own-key one,
 * so no cap of the owner's is checked on the way.
 */
export class MissingKeyModel implements TextModel {
  readonly provider = "none" + OWN_KEY_SUFFIX;
  constructor(
    readonly model: string,
    private readonly message: string,
  ) {}
  generate(): never {
    throw new AiNotConfigured(this.message);
  }
}
