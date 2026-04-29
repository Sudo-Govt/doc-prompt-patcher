// src/lib/generationHash.ts
// Stable canonical JSON + SHA-256 hash for generation inputs.
// Runs in the browser via Web Crypto. No deps.

export type GenerationInputs = {
  templateId: string;
  promptVersion: string;            // bump this when the prompt template changes
  fields: Record<string, unknown>;  // user-filled values
  model?: string;
  params?: Record<string, unknown>; // temperature, maxTokens, etc.
  sources?: Array<{ id: string; hash: string }>; // referenced docs
  outputFormat: "pdf" | "docx" | "md" | string;
};

/** Deterministic JSON: keys sorted at every depth, no whitespace. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function normalizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields).sort()) {
    const v = fields[k];
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

export function canonicalize(inputs: GenerationInputs): string {
  return stableStringify({
    templateId: inputs.templateId,
    promptVersion: inputs.promptVersion,
    fields: normalizeFields(inputs.fields),
    model: inputs.model ?? "",
    params: inputs.params ? normalizeFields(inputs.params) : {},
    sources: (inputs.sources ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
    outputFormat: inputs.outputFormat,
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeInputHash(inputs: GenerationInputs): Promise<string> {
  return sha256Hex(canonicalize(inputs));
}
