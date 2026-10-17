import Anthropic from "@anthropic-ai/sdk";
import { AiError, AiRefused, type TextModel, type TextRequest, type TextResult } from "./model";

export const CLAUDE_MODEL = "claude-opus-5-5";

/**
 * The real Claude API. If Claude declines a request for safety reasons, the
 * API's server-side fallback ("default") retries it on another model inside
 * the same call; the result records which model answered. Haiku has no such
 * fallback, so its refusals reach the reader as refusals.
 */
export class ClaudeModel implements TextModel {
  readonly provider = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model = CLAUDE_MODEL,
    options: { fetch?: typeof fetch; baseURL?: string } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, ...options });
  }

  async generate(req: TextRequest): Promise<TextResult> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        // Haiku 5.5 has no server-side fallback: a declined request stays declined.
        ...(this.model.startsWith("claude-haiku-") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        thinking: { type: "adaptive", display: "omitted" },
        output_config: req.schema ? { effort: req.effort, format: { type: "json_schema", schema: req.schema } } : { effort: req.effort },
        // The system prompt (the long fixed instructions) goes into Anthropic's
        // prompt cache for 5 minutes: the next call with the same instructions
        // reads it back at a fraction of the price. One shorter than the
        // model's minimum (512 tokens) is simply not cached, at no extra cost.
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.prompt }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("The Anthropic API key was refused.");
      if (e instanceof Anthropic.RateLimitError) throw new AiError("Claude is busy (rate limit). Try again in a minute.");
      if (e instanceof Anthropic.APIError) throw new AiError(`Claude could not answer (${e.status ?? "network"}).`);
      throw e;
    }
    if (response.stop_reason === "refusal") {
      throw new AiRefused(response.stop_details?.explanation || "Claude declined to rewrite this passage.");
    }
    if (response.stop_reason === "max_tokens") throw new AiError("The answer was cut off before it finished.");
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new AiError("Claude returned no text.");
    const write = response.usage.cache_creation_input_tokens ?? 0;
    const read = response.usage.cache_read_input_tokens ?? 0;
    return {
      text,
      model: response.model,
      inputTokens: response.usage.input_tokens + write + read,
      outputTokens: response.usage.output_tokens,
      cache: { write, read },
    };
  }
}
