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
  if (req.schema) return JSON.stringify(/question/i.test(task) ? fakeQuestions(text) : fakeConcepts(text));
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const answer = `Fake ${task.toLowerCase()}: ${sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim()}`;
  // STE answers carry a notes section, like the real prompt asks for.
  return /STE/.test(task) ? `${answer}\n---notes---\n- The test AI chose no meanings; this note shows where real ones go.` : answer;
}

/** Prerequisites: the first few capitalised words of the text, as made-up concepts. */
function fakeConcepts(text: string) {
  const names = [...new Set(text.match(/\b[A-Z][a-z]{3,}\b/g) ?? [])].slice(0, 3);
  return {
    concepts: names.map((name) => ({
      name,
      explanation: `A made-up explanation of ${name} from the test AI. The real one comes from Claude.`,
      read_more: name,
    })),
  };
}

/** A question bank: three made-up questions of each kind about the text's first words. */
function fakeQuestions(text: string) {
  const names = [...new Set(text.match(/\b[A-Z][a-z]{3,}\b/g) ?? ["this"])];
  const pick = (i: number) => names[i % names.length];
  return {
    questions: (["recall", "understanding", "application"] as const).flatMap((type, t) =>
      [0, 1, 2].map((i) => ({
        type,
        question: `Test AI ${type} question ${i + 1}: what about ${pick(t * 3 + i)}?`,
        answer: `A made-up model answer about ${pick(t * 3 + i)}.`,
      })),
    ),
  };
}
