import Anthropic from "@anthropic-ai/sdk";
import { AiError, AiRefused, type TextModel, type TextRequest, type TextResult } from "./model";

export const CLAUDE_MODEL = "claude-opus-5-5";

/**
 * The real Claude API. If Claude declines a request for safety reasons, the
 * API's server-side fallback ("default") retries it on another model inside
 * the same call; the result records which model answered.
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
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "omitted" },
        output_config: { effort: req.effort },
        system: req.system,
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
    return {
      text,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }
}
