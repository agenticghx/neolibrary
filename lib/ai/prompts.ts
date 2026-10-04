import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Prompts live in `prompts/` as plain files so they are easy to edit (M6).
 * A prompt file holds the system prompt, then a line `---user---`, then the
 * message template. `{{name}}` marks a value filled in at run time.
 *
 * Every stored answer records the sha256 fingerprint of the prompt files it
 * was made with (ground rule 5), so editing a prompt never mislabels old
 * answers: they keep the old fingerprint, and new requests get new answers.
 */
const DIR = path.join(process.cwd(), "prompts");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class PromptError extends Error {}

export async function readPrompt(name: string) {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(name)) throw new PromptError(`Bad prompt name: ${name}`);
  return readFile(path.join(DIR, `${name}.md`), "utf8");
}

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new PromptError(`The prompt needs a value for {{${key}}}.`);
    return vars[key];
  });
}

/** Splits a prompt file into its system part and its message template. */
export function splitPrompt(file: string) {
  const [system, user, ...rest] = file.split(/^---user---$/m);
  if (user === undefined || rest.length) throw new PromptError("A prompt file needs exactly one ---user--- line.");
  return { system: system.trim(), user: user.trim() };
}
