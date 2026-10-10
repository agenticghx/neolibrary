import { readPrompt } from "./prompts";

/** Samuel's plain-english skill (without its header), as sent to Claude for Plain rewrites. */
export async function plainSkill() {
  return (await readPrompt("plain/SKILL")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}
