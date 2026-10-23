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
  const task = /^Task: (.+)$/m.exec(req.prompt)?.[1] ?? "answer";
  if (task === "Ask this book") return fakeAsk(req.prompt);
  if (task === "Explain it back") return JSON.stringify(fakeExplainBack(req.prompt));
  if (task === "Who and what") return JSON.stringify(fakeXray(req.prompt));
  if (task === "From the world") {
    const name = /^Name: (.+?) \(/m.exec(req.prompt)?.[1] ?? "this name";
    return `The test AI's general knowledge of ${name}: a made-up note, labelled as from outside the book. The real one comes from Claude.`;
  }
  const text = /<passage>\s*([\s\S]*?)\s*<\/passage>/.exec(req.prompt)?.[1] ?? req.prompt;
  if (req.schema) return JSON.stringify(/question/i.test(task) ? fakeQuestions(text) : fakeConcepts(text));
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const answer = `Fake ${task.toLowerCase()}: ${sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim()}`;
  // STE answers carry a notes section, like the real prompt asks for.
  return /STE/.test(task) ? `${answer}\n---notes---\n- The test AI chose no meanings; this note shows where real ones go.` : answer;
}

/**
 * Ask this book (M21): quotes the start of passage 1 and cites it as [1]; with no passages, says the book does
 * not answer it, as the real prompt asks.
 */
function fakeAsk(prompt: string) {
  const first = /<passage n="1"[^>]*>\s*([\s\S]*?)\s*<\/passage>/.exec(prompt)?.[1];
  if (!first) return "The passages found in this book do not answer this. (The test AI was given no passages.)";
  const words = first.replace(/\s+/g, " ").split(" ").slice(0, 12).join(" ");
  return `The test AI's answer, from the passages: the book says “${words}…” [1]`;
}

/**
 * Explain it back (M26 R1): one "missed" item quoting passage 1's first words exactly, and, when there is a second
 * passage, one "misread" item quoting its first words. Real quotes, so the app's quote check passes. Each has a
 * question (M28 S2) that does not copy its quote.
 */
function fakeExplainBack(prompt: string) {
  const first = (n: number) => {
    const text = new RegExp(`<passage n="${n}"[^>]*>\\s*([\\s\\S]*?)\\s*</passage>`).exec(prompt)?.[1];
    // Its first twelve words, copied as they are (a sentence would stop at "Mr.").
    return text ? text.split(/\s+/).slice(0, 12).join(" ") : null;
  };
  const items: { kind: string; passage: number; quote: string; why: string; question: string }[] = [];
  const one = first(1);
  if (one)
    items.push({
      kind: "missed",
      passage: 1,
      quote: one,
      why: "The test AI says your summary leaves out how this part opens.",
      question: "Test AI question: how does this part open?",
    });
  const two = first(2);
  if (two)
    items.push({
      kind: "misread",
      passage: 2,
      quote: two,
      why: "The test AI says the text puts this differently from your summary.",
      question: "Test AI question: what does the text really say in its second passage?",
    });
  return { items };
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

/**
 * Who and what (M32 X3): for each known entry whose name is in the chapter, and for a few capitalised words of its
 * first passages, one fact quoting the first eight words of a passage exactly (so the app's quote check keeps it),
 * plus one planted entry whose quote is not in the book, so the dropped count can be seen and tested. The fake is
 * one shared model in browser tests, so the planted fact is always there.
 */
function fakeXray(prompt: string) {
  const passages = [...prompt.matchAll(/<passage n="(\d+)">\s*([\s\S]*?)\s*<\/passage>/g)].map((m) => ({ n: Number(m[1]), text: m[2] }));
  const known = (/<known>\s*([\s\S]*?)\s*<\/known>/.exec(prompt)?.[1] ?? "")
    .split("\n")
    .map((l) => /^(.+?) \(/.exec(l)?.[1]?.trim())
    .filter((n): n is string => !!n && n !== "(none yet)");
  const first = (p: { text: string }) => p.text.split(/\s+/).slice(0, 8).join(" ");
  const entries: { name: string; kind: string; aliases: string[]; same_as: string | null; facts: { passage: number; fact: string; quote: string }[] }[] = [];
  const named = new Set<string>();
  for (const k of known) {
    const last = k.split(" ").pop()!;
    const p = passages.find((x) => x.text.includes(last));
    if (!p || named.has(k)) continue;
    named.add(k);
    entries.push({ name: k, kind: "person", aliases: [k, last], same_as: k, facts: [{ passage: p.n, fact: `The test AI says this chapter names ${k} here.`, quote: first(p) }] });
  }
  for (const p of passages.slice(0, 3)) {
    for (const w of [...new Set(p.text.match(/\b[A-Z][a-z]{3,}\b/g) ?? [])]) {
      if (entries.length >= 6) break;
      if (named.has(w) || known.some((k) => k.includes(w))) continue;
      named.add(w);
      entries.push({ name: w, kind: "term", aliases: [w], same_as: null, facts: [{ passage: p.n, fact: `A made-up fact about ${w} from the test AI.`, quote: first(p) }] });
    }
  }
  entries.push({ name: "Green Cheese", kind: "term", aliases: ["Green Cheese"], same_as: null, facts: [{ passage: 1, fact: "A planted fact whose quote is not in the book.", quote: "The moon was made of green cheese." }] });
  return { entries };
}
