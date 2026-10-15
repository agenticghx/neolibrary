/**
 * The batch interface (M25 S2, ground rule 3). A batch is many requests sent
 * together to Anthropic's Message Batches API: answered within 24 hours
 * (usually within one), at half the usual price. The app only talks to this
 * interface: `ClaudeBatchModel` (./claude-batch) calls the real API,
 * `FakeBatchModel` answers at once in tests and costs nothing.
 */
import { costUsd } from "./model";

/** The model that reads scanned pages (Samuel's choice, 2026-10-15: docs/scan-to-text-plan.md). */
export const TRANSCRIBE_MODEL = "claude-sonnet-5-5";

export type BatchImage = { mediaType: "image/png" | "image/jpeg"; base64: string };

export type BatchRequest = {
  /** Our own name for the request (1-64 letters, digits, - or _); results come back under it. */
  id: string;
  /** Pictures shown before the text, in this order. */
  images: BatchImage[];
  prompt: string;
  /** Upper limit on output, thinking included. */
  maxTokens: number;
};

export type BatchStatus = {
  id: string;
  /** "ended": every request has an answer (or failed, was cancelled or expired), so results can be read. */
  state: "in_progress" | "canceling" | "ended";
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
};

export type BatchResult =
  | { id: string; kind: "succeeded"; text: string; model: string; inputTokens: number; outputTokens: number }
  /** Claude declined, the answer was cut off, or the request failed: nothing usable, and only an answer that ran is billed. */
  | { id: string; kind: "refused" | "errored"; message: string; model?: string; inputTokens?: number; outputTokens?: number }
  /** Never sent to the model (the batch was cancelled or ran out of time): not billed. */
  | { id: string; kind: "canceled" | "expired" };

export interface TextBatchModel {
  /** The provider, for spending caps ("anthropic"). */
  readonly provider: string;
  /** The model asked for. */
  readonly model: string;
  /** Sends the requests as one batch; returns the batch's number. */
  submit(requests: BatchRequest[]): Promise<string>;
  status(batchId: string): Promise<BatchStatus>;
  /** Every request's outcome. Only once `status` says "ended". */
  results(batchId: string): Promise<BatchResult[]>;
  /** Stops the requests not yet sent to the model; they are not billed. */
  cancel(batchId: string): Promise<void>;
}

/** What a batched answer costs: half the usual price (Anthropic's batch pricing). */
export function batchCostUsd(model: string, inputTokens: number, outputTokens: number) {
  return costUsd(model, inputTokens, outputTokens) / 2;
}

/**
 * The stand-in for tests: a batch is answered as soon as it is sent (or after
 * `pollsUntilEnded` status checks), with `answer(request)` as each text.
 */
export class FakeBatchModel implements TextBatchModel {
  readonly provider = "anthropic";
  readonly model = "fake";
  readonly batches = new Map<string, { requests: BatchRequest[]; polls: number; canceled: boolean }>();
  private next = 1;

  constructor(
    private options: {
      answer?: (request: BatchRequest) => BatchResult | string;
      pollsUntilEnded?: number;
    } = {},
  ) {}

  async submit(requests: BatchRequest[]) {
    const id = `fakebatch_${this.next++}`;
    this.batches.set(id, { requests, polls: 0, canceled: false });
    return id;
  }

  private batch(batchId: string) {
    const b = this.batches.get(batchId);
    if (!b) throw new Error(`No such batch: ${batchId}`);
    return b;
  }

  async status(batchId: string): Promise<BatchStatus> {
    const b = this.batch(batchId);
    b.polls++;
    const ended = b.canceled || b.polls > (this.options.pollsUntilEnded ?? 0);
    const results = ended ? await this.results(batchId) : [];
    const count = (kind: BatchResult["kind"]) => results.filter((r) => r.kind === kind).length;
    return {
      id: batchId,
      state: ended ? "ended" : "in_progress",
      counts: {
        processing: ended ? 0 : b.requests.length,
        succeeded: count("succeeded"),
        errored: count("errored") + count("refused"),
        canceled: count("canceled"),
        expired: count("expired"),
      },
    };
  }

  async results(batchId: string): Promise<BatchResult[]> {
    const b = this.batch(batchId);
    return b.requests.map((request) => {
      if (b.canceled) return { id: request.id, kind: "canceled" };
      const answer = this.options.answer?.(request) ?? `Fake transcription of ${request.id}.`;
      if (typeof answer !== "string") return answer;
      return { id: request.id, kind: "succeeded", text: answer, model: this.model, inputTokens: 4000, outputTokens: 700 };
    });
  }

  async cancel(batchId: string) {
    this.batch(batchId).canceled = true;
  }
}
