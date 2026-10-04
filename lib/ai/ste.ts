/**
 * A TypeScript port of `prompts/ste/ste_check.py` (Samuel's STE checker):
 * measures text against the measurable parts of ASD-STE100 (Simplified
 * Technical English). It must give the same results as the Python script on
 * the same input; `ste.test.ts` runs both and compares.
 *
 * Python and JavaScript regular expressions differ in small ways, so a few
 * patterns are spelled out: `\b` and `\d` follow Python's Unicode rules,
 * `.` never matches a line break only for "\n" (as in Python), and `^`/`$`
 * in multi-line mode only see "\n".
 *
 * This is a heuristic linter, not a certification tool: read every finding.
 */
export const MAX_WORDS_PROCEDURAL = 20;
export const MAX_WORDS_DESCRIPTIVE = 25;
const MAX_SENTENCES_PER_PARAGRAPH = 6;
const MAX_NOUN_CLUSTER = 3;

// ---------------------------------------------------------------- word data

const AMBIGUOUS: Record<string, string> = {
  since: "after / because",
  while: "when / although",
  once: "when / one time",
  following: "after / these",
  as: "because / when / like",
};

const VERBOSE: Record<string, string> = {
  "in order to": "to",
  "in the event that": "if",
  "prior to": "before",
  "subsequent to": "after",
  "in the vicinity of": "near",
  "with regard to": "about",
  "with respect to": "about",
  "for the purpose of": "to",
  "in conjunction with": "with",
  "a number of": "some / many",
  "the majority of": "most",
  "at this point in time": "now",
  "due to the fact that": "because",
  "in spite of the fact that": "although",
  "care should be taken": "state the hazard directly",
  "it is necessary to": "you must",
  "in the process of": "omit",
};

const FORMAL: Record<string, string> = {
  utilize: "use", utilise: "use", utilizing: "use", utilising: "use",
  commence: "start", initiate: "start", terminate: "stop", cease: "stop",
  ascertain: "find", endeavour: "try", endeavor: "try",
  procure: "get", obtain: "get", perform: "do", conduct: "do",
  execute: "do", indicate: "show", demonstrate: "show",
  facilitate: "help", implement: "do / install",
  sufficient: "enough", additional: "more", approximately: "about",
  numerous: "many", assist: "help", purchase: "buy",
  verify: "check", modify: "change", eliminate: "remove",
  accomplish: "do", optimal: "best", via: "by / through",
  regarding: "about", necessitate: "need", leverage: "use",
  methodology: "method", functionality: "function",
  prioritize: "rank", prioritise: "rank",
};

// words that are non-approved only in certain parts of speech -- flagged softly
const SOFT: Record<string, string> = {
  monitor: "look at / check / record (noun in the dictionary)",
  impact: "effect (noun) / change (verb)",
  reference: "refer to",
  interface: "connect to",
  action: "do (verb use is non-approved)",
};

const IRREGULAR_PARTICIPLES = new Set([
  "done", "made", "given", "taken", "seen", "shown", "known", "found",
  "held", "kept", "left", "lost", "meant", "met", "paid", "put", "read",
  "run", "said", "sent", "set", "shut", "sold", "spent", "told", "understood",
  "written", "driven", "chosen", "broken", "spoken", "frozen", "grown",
  "drawn", "worn", "torn", "built", "burnt", "dealt", "felt", "cut",
]);

const BE_FORMS = new Set(["is", "are", "was", "were", "be", "been", "being", "am"]);

// -ing words that are legitimate parts of technical names
const ING_ALLOWLIST = new Set([
  "landing", "sequencing", "binding", "operating", "housing", "bearing",
  "coating", "casing", "tubing", "wiring", "packaging", "training",
  "engineering", "screening", "imaging", "sampling", "during", "string",
  "spring", "ring", "thing", "morning", "everything", "something",
  "nothing", "anything", "being", "king", "wing",
]);

// Words that end a noun cluster: function words plus high-frequency verbs,
// comparatives and quantifiers.
const CLUSTER_STOP = new Set([
  // determiners, pronouns, prepositions, conjunctions
  "the", "a", "an", "this", "that", "these", "those", "each", "every", "any",
  "some", "no", "all", "both", "either", "neither", "such", "its", "his",
  "her", "their", "our", "your", "my", "it", "he", "she", "they", "we",
  "you", "i", "who", "whom", "whose", "which", "what", "there", "here",
  "of", "to", "in", "on", "at", "for", "with", "and", "or", "but", "if",
  "by", "from", "into", "onto", "over", "under", "above", "below", "between",
  "through", "during", "after", "before", "than", "then", "when", "while",
  "as", "so", "because", "since", "until", "unless", "although", "though",
  "about", "against", "across", "along", "among", "around", "behind",
  "beside", "beyond", "near", "off", "out", "up", "down", "per", "via",
  "within", "without", "upon", "toward", "towards", "not", "nor", "yet",
  // be / have / do / modals
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have",
  "had", "do", "does", "did", "can", "could", "will", "would", "shall",
  "should", "may", "might", "must", "let", "lets",
  // very common lexical verbs
  "use", "uses", "make", "makes", "take", "takes", "give", "gives", "get",
  "gets", "go", "goes", "come", "comes", "see", "sees", "know", "knows",
  "become", "becomes", "cause", "causes", "show", "shows", "find", "finds",
  "need", "needs", "want", "wants", "keep", "keeps", "put", "puts", "set",
  "sets", "run", "runs", "hold", "holds", "start", "starts", "stop", "stops",
  "open", "opens", "close", "closes", "add", "adds", "remove", "removes",
  "check", "checks", "read", "reads", "write", "writes", "move", "moves",
  "turn", "turns", "look", "looks", "work", "works", "help", "helps",
  "mean", "means", "occur", "occurs", "apply", "applies", "allow", "allows",
  "contain", "contains", "include", "includes", "produce", "produces",
  // quantity / degree
  "more", "most", "less", "least", "many", "much", "few", "several", "very",
  "too", "only", "also", "just", "even", "still", "again", "now", "always",
  "never", "often", "usually", "first", "second", "third", "next", "last",
]);

// Python's \b and \d for text, in JavaScript (needs the "u" flag).
const W = String.raw`[\p{L}\p{N}_]`;
const B_START = String.raw`(?<!${W})(?=${W})`;
const B_END = String.raw`(?<=${W})(?!${W})`;
const BOUNDARY = String.raw`(?:${B_START}|${B_END})`;
const D = String.raw`\p{Nd}`;
// Python's \s (str.isspace): like JavaScript's, plus \x1c-\x1f and \x85, minus \ufeff.
const S = String.raw`[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const NOT_S = String.raw`[^\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;

const CONTRACTIONS = new RegExp(
  String.raw`${BOUNDARY}(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|` +
    String.raw`hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|mustn't|it's|` +
    String.raw`that's|there's|they're|we're|you're|i'm|let's|we'll|you'll|it'll)${BOUNDARY}`,
  "giu",
);

// A Python set: the order only matters for the replacements, which do not overlap.
const ABBREVIATIONS = [
  "e.g", "i.e", "etc", "vs", "fig", "no", "approx", "dr", "mr", "mrs",
  "ms", "prof", "st", "cf", "al", "min", "max", "sec", "hr", "ca",
];

// ---------------------------------------------------------------- structures

export type Severity = "error" | "warning" | "info";
export type Finding = { kind: string; severity: Severity; line: number; message: string; excerpt: string; suggestion: string };

export type SteReport = {
  mode: "procedural" | "descriptive";
  sentence_limit: number;
  paragraphs: number;
  sentences: number;
  words: number;
  errors: number;
  warnings: number;
  /** Percent of sentences with no error-level finding, to one decimal (the full-STE score). */
  compliance: number;
  findings: Finding[];
};

const finding = (kind: string, severity: Severity, line: number, message: string, excerpt = "", suggestion = ""): Finding => ({
  kind,
  severity,
  line,
  message,
  excerpt,
  suggestion,
});

// Python slices strings by code point, not by UTF-16 unit.
const head = (s: string, n = 110) => Array.from(s).slice(0, n).join("");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Python's str.strip() and str.isalpha() for the cases that matter here.
const isAlpha = (c: string) => /^\p{L}$/u.test(c);

// ---------------------------------------------------------------- text utils

// Multi-line ^ and $ as Python sees them: only "\n" ends a line.
const LINE_START = String.raw`(?:(?<![\s\S])|(?<=\n))`;
const LINE_END = String.raw`(?=\n|(?![\s\S]))`;

/** Remove fenced code, inline code, URLs and markdown tables. */
export function stripNoise(text: string): string {
  text = text.replace(/```[\s\S]*?```/gu, "");
  text = text.replace(/~~~[\s\S]*?~~~/gu, "");
  text = text.replace(/`[^`]*`/gu, "");
  text = text.replace(new RegExp(String.raw`https?://${NOT_S}+`, "gu"), "");
  text = text.replace(new RegExp(String.raw`${LINE_START}${S}*\|[^\n]*\|${S}*${LINE_END}`, "gu"), ""); // table rows
  text = text.replace(new RegExp(String.raw`${LINE_START}${S}*[-=]{3,}${S}*${LINE_END}`, "gu"), ""); // rules
  return text;
}

/** [start_line, paragraph_text] pairs. Blank lines separate paragraphs. */
export function splitParagraphs(text: string): [number, string][] {
  const out: [number, string][] = [];
  let buf: string[] = [];
  let start = 1;
  text.split("\n").forEach((line, idx) => {
    const i = idx + 1;
    if (pyStrip(line)) {
      if (!buf.length) start = i;
      buf.push(line);
    } else if (buf.length) {
      out.push([start, buf.join(" ")]);
      buf = [];
    }
  });
  if (buf.length) out.push([start, buf.join(" ")]);
  return out;
}

// Python's str.strip().
const pyStrip = (s: string) => s.replace(new RegExp(String.raw`^${S}+|${S}+$`, "gu"), "");

/** Split on . ! ? followed by space+capital, protecting abbreviations. */
export function splitSentences(para: string): string[] {
  para = para.replace(new RegExp(String.raw`^${S}*(?:[-*+]|${D}+[.)])${S}+`, "u"), ""); // list markers
  para = para.replace(new RegExp(String.raw`^#{1,6}${S}+`, "u"), ""); // headings
  let protectedText = para.replace(new RegExp(String.raw`(${D})\.(${D})`, "gu"), "$1<DOT>$2"); // decimals
  for (const abbr of ABBREVIATIONS) {
    protectedText = protectedText.replace(new RegExp(String.raw`${BOUNDARY}${escapeRe(abbr)}\.`, "giu"), `${abbr}<DOT>`);
  }
  const parts = protectedText.split(new RegExp(String.raw`(?<=[.!?])${S}+(?=[A-Z0-9"'(])`, "u"));
  return parts.map((p) => pyStrip(p.replaceAll("<DOT>", "."))).filter((p) => p);
}

export function wordsOf(sentence: string): string[] {
  const cleaned = sentence.replace(/[*_#>[\]()]/gu, " ");
  return cleaned.match(new RegExp(String.raw`[A-Za-z][A-Za-z'\-]*|${D}+(?:\.${D}+)?`, "gu")) ?? [];
}

function looksLikeParticiple(word: string): boolean {
  const lw = word.toLowerCase();
  if (IRREGULAR_PARTICIPLES.has(lw)) return true;
  return lw.endsWith("ed") && Array.from(lw).length > 4;
}

// ---------------------------------------------------------------- the checks

function checkSentence(s: string, line: number, limit: number, findings: Finding[]) {
  const ws = wordsOf(s);
  const n = ws.length;
  const low = " " + s.toLowerCase() + " ";
  const ex = head(s);

  if (n > limit) {
    findings.push(finding("sentence_length", "error", line, `${n} words (limit ${limit}). Split it into separate sentences.`, ex));
  }

  // passive voice: a form of "be" followed (within 2 words) by a participle
  const lw = ws.map((w) => w.toLowerCase());
  passive: for (let i = 0; i < lw.length; i++) {
    if (!BE_FORMS.has(lw[i])) continue;
    for (let j = i + 1; j < Math.min(i + 3, lw.length); j++) {
      if (looksLikeParticiple(lw[j])) {
        findings.push(
          finding(
            "passive_voice",
            "warning",
            line,
            `possible passive voice: "${ws[i]} ${ws.slice(i + 1, j + 1).join(" ")}" -- name the actor, or use the imperative.`,
            ex,
          ),
        );
        break passive;
      }
    }
  }

  // forbidden verb forms
  lw.forEach((w, i) => {
    if (["is", "are", "was", "were", "be", "been", "am"].includes(w) && i + 1 < lw.length) {
      const nxt = lw[i + 1];
      if (nxt.endsWith("ing") && !ING_ALLOWLIST.has(nxt)) {
        findings.push(
          finding("continuous_tense", "error", line, `continuous tense "${ws[i]} ${ws[i + 1]}" -- use the simple present or past.`, ex),
        );
      }
    }
    if (["has", "have", "had"].includes(w) && i + 1 < lw.length) {
      if (looksLikeParticiple(lw[i + 1])) {
        findings.push(finding("perfect_tense", "error", line, `perfect tense "${ws[i]} ${ws[i + 1]}" -- use the simple past.`, ex));
      }
    }
  });

  // -ing at the start of a clause (gerund / participial phrase)
  for (const m of s.matchAll(new RegExp(String.raw`(?:^|,${S}+|;${S}+)([A-Za-z]+ing)${BOUNDARY}`, "gu"))) {
    const w = m[1].toLowerCase();
    if (!ING_ALLOWLIST.has(w)) {
      findings.push(
        finding("ing_form", "warning", line, `"-ing" form "${m[1]}" starting a clause -- rewrite with a subject and a simple verb.`, ex),
      );
    }
  }

  // Noun clusters (approximate: runs of words that are not function words,
  // verbs or adverbs).
  const breaksCluster = (w: string) => {
    const lw = w.toLowerCase();
    const len = Array.from(lw).length;
    if (CLUSTER_STOP.has(lw) || w.includes("'") || !isAlpha(Array.from(w)[0])) return true;
    if (lw.endsWith("ly") && len > 4) return true;
    if (lw.endsWith("ed") && len > 4) return true;
    if (lw.endsWith("ing") && !ING_ALLOWLIST.has(lw)) return true;
    return false;
  };
  const flush = (run: string[]) => {
    if (run.length > MAX_NOUN_CLUSTER) {
      findings.push(
        finding(
          "noun_cluster",
          "warning",
          line,
          `possible noun cluster of ${run.length} words: "${run.join(" ")}" -- unpack it with prepositions, or confirm it is a single technical name.`,
          ex,
        ),
      );
    }
  };
  let run: string[] = [];
  for (const w of ws) {
    if (breaksCluster(w)) {
      flush(run);
      run = [];
    } else run.push(w);
  }
  flush(run);

  // vocabulary
  for (const [phrase, better] of Object.entries(VERBOSE)) {
    if (low.includes(phrase)) findings.push(finding("verbose_phrase", "warning", line, `"${phrase}" -> "${better}"`, ex, better));
  }
  const seen = new Set<string>();
  for (const w of lw) {
    if (seen.has(w)) continue;
    seen.add(w);
    if (Object.hasOwn(FORMAL, w)) findings.push(finding("non_approved_word", "warning", line, `"${w}" -> "${FORMAL[w]}"`, ex, FORMAL[w]));
    else if (Object.hasOwn(AMBIGUOUS, w)) {
      findings.push(finding("ambiguous_word", "warning", line, `"${w}" has more than one meaning -> "${AMBIGUOUS[w]}"`, ex, AMBIGUOUS[w]));
    } else if (Object.hasOwn(SOFT, w)) findings.push(finding("part_of_speech", "info", line, `"${w}": ${SOFT[w]}`, ex, SOFT[w]));
  }

  for (const m of s.matchAll(CONTRACTIONS)) {
    findings.push(finding("contraction", "warning", line, `contraction "${m[0]}" -- write it in full.`, ex));
  }

  // "/" used as and/or
  if (new RegExp(String.raw`${W}/${W}`, "u").test(s) && !new RegExp(String.raw`https?://|${D}+/${D}+`, "u").test(s)) {
    findings.push(finding("slash", "info", line, 'a "/" between words is ambiguous -- write "and" or "or".', ex));
  }
}

/** Python's round(x, 1): the exact binary value, ties to even. */
function pyRound1(x: number) {
  const t = x * 10;
  if (Number.isInteger(x * 4) && Math.abs(t % 1) === 0.5) {
    const f = Math.floor(t);
    return (f % 2 === 0 ? f : f + 1) / 10;
  }
  return Number(x.toFixed(1));
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function steCheck(text: string, procedural = false): SteReport {
  const limit = procedural ? MAX_WORDS_PROCEDURAL : MAX_WORDS_DESCRIPTIVE;
  const findings: Finding[] = [];
  let paragraphs = 0;
  let sentences = 0;
  let words = 0;

  for (const [startLine, para] of splitParagraphs(stripNoise(text))) {
    const list = splitSentences(para);
    if (!list.length) continue;
    paragraphs += 1;
    if (list.length > MAX_SENTENCES_PER_PARAGRAPH) {
      findings.push(
        finding(
          "paragraph_length",
          "warning",
          startLine,
          `${list.length} sentences in one paragraph (limit ${MAX_SENTENCES_PER_PARAGRAPH}). Split it, or check that it holds only one topic.`,
        ),
      );
    }
    for (const s of list) {
      sentences += 1;
      words += wordsOf(s).length;
      checkSentence(s, startLine, limit, findings);
    }
  }

  findings.sort((a, b) => a.line - b.line || RANK[a.severity] - RANK[b.severity]);
  const bad = new Set(findings.filter((f) => f.severity === "error").map((f) => f.line));
  const compliance = sentences ? (100.0 * Math.max(0, sentences - bad.size)) / sentences : 100.0;
  return {
    mode: procedural ? "procedural" : "descriptive",
    sentence_limit: limit,
    paragraphs,
    sentences,
    words,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    compliance: pyRound1(compliance),
    findings,
  };
}
