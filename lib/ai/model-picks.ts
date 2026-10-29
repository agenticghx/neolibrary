import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";
import { getTextModel } from "./index";
import { FEATURE_MODELS, MODEL_CHOICES, defaultModelFor, type AiFeature, type ModelPicks } from "./model";

/**
 * Which Claude model answers each AI feature, picked by the owner on the
 * Spending page (M35, 2026-10-29, Samuel: owner-only, since one key pays for
 * every reader). Saved answers are never thrown away by a change: they keep
 * being served free, each labelled with the model that made it. New questions
 * and "ask again" use the new pick.
 */
const NAME = "ai-models";

/** What each feature is called on screen, in the order the Spending page lists them. */
export const FEATURE_LABELS: Record<AiFeature, string> = {
  rewrite: "Rewrites",
  prerequisites: "Need to know",
  questions: "Test yourself",
  "explain-back": "Explain it back",
  ask: "Ask the book",
  xray: "X-ray: reading a chapter",
  "xray-world": "X-ray: about a name",
};

export const FEATURES = Object.keys(FEATURE_LABELS) as AiFeature[];

export class ModelPickError extends Error {}

/** The owner's picks; a feature left out uses its default. */
export async function getModelPicks(db: Db): Promise<ModelPicks> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.name, NAME));
  return (row?.value ?? {}) as ModelPicks;
}

/**
 * Saves the picks. "default" (or nothing) for a feature removes its pick, so
 * it follows the server setting or built-in default again. Anything not on
 * the list is refused, so the spending cap always knows the price.
 */
export async function setModelPicks(db: Db, adminId: string, wanted: Partial<Record<string, string>>, now = new Date()) {
  const picks: ModelPicks = {};
  for (const feature of FEATURES) {
    const m = wanted[feature]?.trim();
    if (!m || m === "default") continue;
    if (!(MODEL_CHOICES as readonly string[]).includes(m)) throw new ModelPickError(`${FEATURE_LABELS[feature]}: "${m}" is not a model you can pick.`);
    picks[feature] = m;
  }
  await db
    .insert(appSettings)
    .values({ name: NAME, value: picks, updatedAt: now, updatedBy: adminId })
    .onConflictDoUpdate({ target: appSettings.name, set: { value: picks, updatedAt: now, updatedBy: adminId } });
  return picks;
}

/** One row of the Spending page: the feature, its default, the owner's pick if any, and the model that answers now. */
export async function modelTable(db: Db, env: Record<string, string | undefined> = process.env) {
  const picks = await getModelPicks(db);
  return FEATURES.map((feature) => {
    const fallback = defaultModelFor(feature, env);
    const picked = picks[feature] && (MODEL_CHOICES as readonly string[]).includes(picks[feature]) ? picks[feature] : null;
    return { feature, label: FEATURE_LABELS[feature], builtIn: FEATURE_MODELS[feature] as string, fallback, picked, answers: picked ?? fallback };
  });
}

/** The model for a feature, with the owner's pick applied. Throws AiNotConfigured with no key, like getTextModel. */
export async function textModel(db: Db, feature: AiFeature, env: Record<string, string | undefined> = process.env) {
  return getTextModel(feature, env, await getModelPicks(db));
}
