import { STRICTNESS, type Strictness } from "@/lib/library/levels";
import { fill, readPrompt } from "./prompts";

/** Samuel's STE skill (without its header) and substitution list, as sent to Claude. */
export async function steSkill() {
  const skill = (await readPrompt("ste/SKILL")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const substitutions = (await readPrompt("ste/substitutions")).trim();
  return { skill, substitutions };
}

/** The instruction that makes an explanation STE at a strictness (`prompts/ste-style.md`). */
export async function steStyleInstruction(strictness: Strictness) {
  return fill((await readPrompt("ste-style")).trim(), { ...(await steSkill()), strictness: STRICTNESS[strictness] });
}
