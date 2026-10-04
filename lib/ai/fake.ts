import { estimateTokens, type TextModel, type TextRequest, type TextResult } from "./model";

/**
 * The fake model used in every test (ground rule 3). It answers instantly,
 * never touches the network and counts its calls, so tests can prove that a
 * stored answer is re-served without a second call.
 */
export class FakeModel implements TextModel {
  readonly provider = "anthropic";
  readonly model = "fake";
  calls: TextRequest[] = [];

  constructor(private answer: (req: TextRequest) => string = fakeAnswer) {}

  async generate(req: TextRequest): Promise<TextResult> {
    this.calls.push(req);
    const text = this.answer(req);
    return { text, model: this.model, inputTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(text) };
  }
}

/** A readable stand-in: the passage's first sentences, labelled with the task. */
function fakeAnswer(req: TextRequest) {
  const text = /<passage>\s*([\s\S]*?)\s*<\/passage>/.exec(req.prompt)?.[1] ?? req.prompt;
  const task = /^Task: (.+)$/m.exec(req.prompt)?.[1] ?? "answer";
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const answer = `Fake ${task.toLowerCase()}: ${sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim()}`;
  // STE answers carry a notes section, like the real prompt asks for.
  return /STE/.test(task) ? `${answer}\n---notes---\n- The test AI chose no meanings; this note shows where real ones go.` : answer;
}
