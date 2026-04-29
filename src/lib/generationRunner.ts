// src/lib/generationRunner.ts
import { computeInputHash, type GenerationInputs } from "./generationHash";
import { fetchExistingByHashes, recordGeneratedDoc, type GeneratedDocRow } from "./generatedDocsRepo";

export type ItemStatus =
  | "idle"
  | "queued"
  | "generating"
  | "done"
  | "already-generated"
  | "failed";

export type GenerationItem = {
  id: string;
  filename: string;
  inputs: GenerationInputs;
  forceRegenerate?: boolean;
  // Populated by the runner:
  inputHash?: string;
  status?: ItemStatus;
  existing?: GeneratedDocRow;
  error?: string;
  generatedAt?: string;
};

export type GenerateFn = (item: GenerationItem) => Promise<{
  outputPath: string;
  filename?: string;
}>;

/** Hash every item and mark which ones can be skipped. Mutates and returns the items. */
export async function preflight(items: GenerationItem[]): Promise<GenerationItem[]> {
  await Promise.all(
    items.map(async (it) => {
      it.inputHash = await computeInputHash(it.inputs);
    }),
  );

  const existing = await fetchExistingByHashes(items.map((i) => i.inputHash!));

  for (const it of items) {
    if (it.forceRegenerate) {
      it.status = "queued";
      continue;
    }
    const hit = existing.get(it.inputHash!);
    if (hit) {
      it.status = "already-generated";
      it.existing = hit;
      it.generatedAt = hit.generated_at;
    } else {
      it.status = "queued";
    }
  }
  return items;
}

/** Runs the generator only on queued items, recording successes. */
export async function runGeneration(
  items: GenerationItem[],
  generate: GenerateFn,
  onUpdate?: (item: GenerationItem) => void,
): Promise<void> {
  for (const it of items) {
    if (it.status !== "queued") continue;
    it.status = "generating";
    onUpdate?.(it);
    try {
      const res = await generate(it);
      await recordGeneratedDoc({
        list_item_id: it.id,
        input_hash: it.inputHash!,
        filename: res.filename ?? it.filename,
        output_path: res.outputPath,
        prompt_version: it.inputs.promptVersion,
      });
      it.status = "done";
      it.generatedAt = new Date().toISOString();
    } catch (e: any) {
      it.status = "failed";
      it.error = e?.message ?? String(e);
    }
    onUpdate?.(it);
  }
}

export function summarize(items: GenerationItem[]) {
  const total = items.length;
  const skipped = items.filter((i) => i.status === "already-generated").length;
  const queued = items.filter((i) => i.status === "queued").length;
  return { total, skipped, queued };
}
