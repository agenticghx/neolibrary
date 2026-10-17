import Anthropic from "@anthropic-ai/sdk";
import { TRANSCRIBE_MODEL, type BatchRequest, type BatchResult, type BatchStatus, type TextBatchModel } from "./batch";
import { AiError } from "./model";

/**
 * The real Message Batches API. Unlike ClaudeModel it sends no server-side
 * fallback (that is for live requests): a page Claude declines comes back as
 * "refused" and can be sent again. Thinking is the model's own (adaptive); effort is
 * set to high, Sonnet 5.5's default, as in the 5-page test (docs/scan-to-text-plan.md).
 */
export class ClaudeBatchModel implements TextBatchModel {
  readonly provider = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model = TRANSCRIBE_MODEL,
    options: { fetch?: typeof fetch; baseURL?: string } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, ...options });
  }

  private async call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("The Anthropic API key was refused.");
      if (e instanceof Anthropic.RateLimitError) throw new AiError(`Claude is busy (rate limit) while ${what}. Try again in a minute.`);
      if (e instanceof Anthropic.APIError) throw new AiError(`Claude could not ${what} (${e.status ?? "network"}).`);
      throw e;
    }
  }

  async submit(requests: BatchRequest[]) {
    const batch = await this.call("start the batch", () =>
      this.client.messages.batches.create({
        requests: requests.map((r) => ({
          custom_id: r.id,
          params: {
            model: this.model,
            max_tokens: r.maxTokens,
            // Set, not left to the default, so a page reads alike here and through claude -p on the laptop
            // (scripts/text-edition-on-subscription.ts, EFFORT).
            output_config: { effort: "high" as const },
            messages: [
              {
                role: "user" as const,
                content: [
                  ...r.images.map((img) => ({
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
                  })),
                  { type: "text" as const, text: r.prompt },
                ],
              },
            ],
          },
        })),
      }),
    );
    return batch.id;
  }

  async status(batchId: string): Promise<BatchStatus> {
    const b = await this.call("check the batch", () => this.client.messages.batches.retrieve(batchId));
    return { id: b.id, state: b.processing_status, counts: { ...b.request_counts } };
  }

  async results(batchId: string): Promise<BatchResult[]> {
    return this.call("read the batch's results", async () => {
      const out: BatchResult[] = [];
      for await (const item of await this.client.messages.batches.results(batchId)) {
        const id = item.custom_id;
        const r = item.result;
        if (r.type === "canceled" || r.type === "expired") {
          out.push({ id, kind: r.type });
        } else if (r.type === "errored") {
          out.push({ id, kind: "errored", message: r.error.error?.message || r.error.error?.type || "The request failed." });
        } else {
          const m = r.message;
          const used = {
            model: m.model,
            inputTokens: m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0),
            outputTokens: m.usage.output_tokens,
          };
          const text = m.content
            .flatMap((b) => (b.type === "text" ? [b.text] : []))
            .join("")
            .trim();
          if (m.stop_reason === "refusal") out.push({ id, kind: "refused", message: m.stop_details?.explanation || "Claude declined to read this page.", ...used });
          else if (m.stop_reason === "max_tokens") out.push({ id, kind: "errored", message: "The answer was cut off before it finished.", ...used });
          else if (!text) out.push({ id, kind: "errored", message: "Claude returned no text.", ...used });
          else out.push({ id, kind: "succeeded", text, ...used });
        }
      }
      return out;
    });
  }

  async cancel(batchId: string) {
    await this.call("cancel the batch", () => this.client.messages.batches.cancel(batchId));
  }
}
