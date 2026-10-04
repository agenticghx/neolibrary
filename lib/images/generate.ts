import OpenAI from "openai";
import { crc32, deflateSync } from "node:zlib";

/**
 * Generated pictures (M9, ground rule 3), for when Wikimedia Commons has
 * nothing good: OpenAI's image model, or a fake that draws a small PNG in
 * code. Generated pictures are always labelled as generated.
 */
export interface ImageGenerator {
  readonly provider: string;
  readonly model: string;
  generate(prompt: string): Promise<{ data: Uint8Array; mime: string }>;
}

export class ImageGenerationError extends Error {}
export class ImageGenerationNotConfigured extends ImageGenerationError {}

export const OPENAI_IMAGE_MODEL = "gpt-image-2";

export class OpenAIImages implements ImageGenerator {
  readonly provider = "openai";
  private client: OpenAI;

  constructor(
    apiKey: string,
    readonly model = OPENAI_IMAGE_MODEL,
    options: { fetch?: typeof fetch; baseURL?: string } = {},
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, ...options });
  }

  async generate(prompt: string) {
    let res;
    try {
      res = await this.client.images.generate({ model: this.model, prompt, n: 1, size: "1024x1024", quality: "medium", output_format: "png" });
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError) throw new ImageGenerationError("The OpenAI API key was refused.");
      if (e instanceof OpenAI.BadRequestError) throw new ImageGenerationError("OpenAI would not draw this picture.");
      if (e instanceof OpenAI.APIError) throw new ImageGenerationError(`OpenAI could not draw this (${e.status ?? "network"}).`);
      throw e;
    }
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new ImageGenerationError("OpenAI returned no picture.");
    return { data: new Uint8Array(Buffer.from(b64, "base64")), mime: "image/png" };
  }
}

/** The fake: a 96 × 64 PNG with soft stripes, coloured from the prompt, made in code. Counts its calls. */
export class FakeImageGenerator implements ImageGenerator {
  readonly provider = "openai";
  readonly model = "fake-image";
  calls: string[] = [];

  async generate(prompt: string) {
    this.calls.push(prompt);
    let h = 0;
    for (const c of prompt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { data: png(96, 64, [80 + (h % 120), 90 + ((h >> 8) % 100), 110 + ((h >> 16) % 100)]), mime: "image/png" };
  }
}

/** A minimal RGB PNG (8-bit, no interlace) with diagonal stripes. */
export function png(width: number, height: number, [r, g, b]: number[]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const light = ((x + y) >> 3) % 2 ? 30 : 0;
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = Math.min(255, r + light);
      raw[i + 1] = Math.min(255, g + light);
      raw[i + 2] = Math.min(255, b + light);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

const g = globalThis as unknown as { __neolibraryFakeImageGen?: FakeImageGenerator };

export function getImageGenerator(env: Record<string, string | undefined> = process.env): ImageGenerator {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeImageGen ??= new FakeImageGenerator());
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new ImageGenerationNotConfigured("Making pictures is not set up yet: the owner needs to add OPENAI_API_KEY.");
  return new OpenAIImages(key);
}

/** US dollars per generated picture (set OPENAI_IMAGE_USD to the real price; cautious default $0.20). */
export function imageUsd(env: Record<string, string | undefined> = process.env) {
  const v = Number(env.OPENAI_IMAGE_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.2;
}
