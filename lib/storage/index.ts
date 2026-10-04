import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where big files (books, covers, audio) live. Ground rule 3: an interface
 * with a fake. MemoryStorage is the test fake; LocalStorage keeps files on
 * disk for development; the S3 bucket implementation arrives with uploads (M3).
 */
export interface Storage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
}

export class MemoryStorage implements Storage {
  private files = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: Uint8Array, contentType: string) {
    assertSafeKey(key);
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    assertSafeKey(key);
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, data: Uint8Array, contentType: string) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
    await writeFile(`${f}.type`, contentType);
  }
  async get(key: string) {
    const f = this.file(key);
    try {
      return { data: new Uint8Array(await readFile(f)), contentType: await readFile(`${f}.type`, "utf8") };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const f = this.file(key);
    await rm(f, { force: true });
    await rm(`${f}.type`, { force: true });
  }
}

const g = globalThis as unknown as { __neolibraryStorage?: Storage };

export function getStorage(): Storage {
  g.__neolibraryStorage ??= new LocalStorage(process.env.FILES_DIR ?? path.join(process.cwd(), ".data", "files"));
  return g.__neolibraryStorage;
}
