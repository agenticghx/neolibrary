/**
 * Proves the prompt cache works (written for whoever runs it: Samuel or a
 * later session). Sends the same STE rewrite of one short made-up paragraph
 * twice through the app's own ClaudeModel and prints the cache figures: the
 * second call should show tokens read from the cache. Paid but tiny: on
 * Haiku 5.5 both calls together cost well under one cent.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/check-prompt-cache.ts [model]
 */
import { ClaudeModel } from "@/lib/ai/claude";
import { costUsd } from "@/lib/ai/model";
import { fill, readPrompt, splitPrompt } from "@/lib/ai/prompts";
import { steSkill } from "@/lib/ai/ste-prompt";

async function main(key: string) {
  const model = new ClaudeModel(key, process.argv[2] ?? "claude-haiku-5-5");
  const { system, user } = splitPrompt(await readPrompt("ste-rewrite"));
  const req = {
    system: fill(system, { ...(await steSkill()), strictness: "standard" }),
    prompt: fill(user, {
      book: "A test book",
      chapter: "One",
      text: "Before the pump is started, it is essential that the operator ascertains that the inlet valve has been opened fully.",
      task: "Rewrite (STE, standard)",
    }),
    maxTokens: 4000,
    effort: "low" as const,
  };
  for (const call of ["first", "second"]) {
    const r = await model.generate(req);
    const cost = costUsd(r.model, r.inputTokens, r.outputTokens, r.cache);
    console.log(`${call} call (${r.model}): input ${r.inputTokens} tokens, of which written to cache ${r.cache?.write ?? 0}, read from cache ${r.cache?.read ?? 0}; output ${r.outputTokens}; cost $${cost.toFixed(5)}`);
  }
}

// This check can only be made on the paid API (the subscription does not report the cache), so it must be
// asked for by name: the project rule is that model work outside the app runs on the subscription.
const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!process.argv.includes("--paid-api") || !key) {
  console.error("This makes two paid calls (well under one cent). Run it with --paid-api and ANTHROPIC_API_KEY set.");
  process.exit(1);
}
main(key).catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
