import {
  RAG_SYSTEM_PROMPT,
  CRIMINAL_LAW_PROMPT,
  PROCEDURAL_LAW_PROMPT,
} from "./ragPrompt";

// ─── Prompt registry ─────────────────────────────────────────────────────────
export type LawType = "constitution" | "criminal" | "procedural" | "default";

export const PROMPT_REGISTRY: Record<LawType, { label: string; prompt: string }> = {
  constitution: { label: "Constitutional", prompt: RAG_SYSTEM_PROMPT },
  criminal:     { label: "Criminal",       prompt: CRIMINAL_LAW_PROMPT },
  procedural:   { label: "Procedural",     prompt: PROCEDURAL_LAW_PROMPT },
  default:      { label: "General",        prompt: RAG_SYSTEM_PROMPT },
};

export function inferLawType(category: string, act: string): LawType {
  const c = (category || "").toLowerCase();
  const a = (act || "").toLowerCase();
  if (c.includes("constitutional") || a.includes("constitution")) return "constitution";
  if (c.includes("procedural") || /procedure|crpc|cpc|nagarik suraksha/.test(a)) return "procedural";
  if (
    c.includes("criminal") ||
    c.includes("national security") ||
    /penal|nyaya sanhita|sakshya|uapa|nsa|afspa|pmla|nia|official secrets/.test(a)
  ) return "criminal";
  return "default";
}

// ─── Gemini call ─────────────────────────────────────────────────────────────
const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

async function callGemini(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  jsonMode = false,
  maxTokens = 8192,
): Promise<string> {
  const body: any = {
    systemInstruction: { role: "system", parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
  };
  if (jsonMode) body.generationConfig.responseMimeType = "application/json";

  const res = await fetch(ENDPOINT(model, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();

  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Output was truncated (MAX_TOKENS). Try a smaller range.");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface PlanItem {
  id: string;
  act: string;
  filename: string;
  lawType?: LawType;
  customPrompt?: string;
}

export interface CatalogItem {
  act: string;
  category: string;
  description: string;
  unit: "Article" | "Section" | "Rule" | "Regulation";
  count: number;
  lawType: LawType;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const safeName = (s: string) =>
  s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

const buildRangePlan = (
  act: string,
  label: string,
  start: number,
  end: number,
  lawType: LawType = "default",
): PlanItem[] =>
  Array.from({ length: end - start + 1 }, (_, idx) => {
    const id = `${label} ${start + idx}`;
    return { act, id, filename: `${safeName(act)}_${safeName(id)}.json`, lawType };
  });

const parseRange = (text: string) => {
  const m = text.match(/(?:articles?|sections?)\s*(\d+)\s*(?:-|to|through|–|—)\s*(\d+)/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return null;
  return { start, end };
};

function planKnownDocument(userRequest: string): PlanItem[] | null {
  const t = userRequest.toLowerCase();
  const r = parseRange(userRequest);
  const mk = (act: string, label: string, defStart: number, defEnd: number, lt: LawType) => {
    const { start, end } = r ?? { start: defStart, end: defEnd };
    return buildRangePlan(act, label, start, end, lt);
  };
  if (/constitution|constituition/.test(t))
    return mk("Constitution of India", "Article", 1, 395, "constitution");
  if (/\bbns\b|bharatiya nyaya sanhita/.test(t))
    return mk("Bharatiya Nyaya Sanhita, 2023", "Section", 1, 358, "criminal");
  if (/\bbnss\b|bharatiya nagarik suraksha sanhita/.test(t))
    return mk("Bharatiya Nagarik Suraksha Sanhita, 2023", "Section", 1, 531, "procedural");
  if (/\bbsa\b|bharatiya sakshya adhiniyam/.test(t))
    return mk("Bharatiya Sakshya Adhiniyam, 2023", "Section", 1, 170, "criminal");
  if (/\bipc\b|indian penal code/.test(t))
    return mk("Indian Penal Code, 1860", "Section", 1, 511, "criminal");
  if (/\bcrpc\b|criminal procedure/.test(t))
    return mk("Code of Criminal Procedure, 1973", "Section", 1, 484, "procedural");
  if (/\bcpc\b|civil procedure/.test(t))
    return mk("Code of Civil Procedure, 1908", "Section", 1, 158, "procedural");
  if (/evidence act/.test(t))
    return mk("Indian Evidence Act, 1872", "Section", 1, 167, "criminal");
  if (/contract act/.test(t))
    return mk("Indian Contract Act, 1872", "Section", 1, 266, "default");
  return null;
}

function extractJsonArray(raw: string): any[] {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/g, "").trim();
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.items)) return v.items;
  } catch {}
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a !== -1 && b > a) {
    try {
      const v = JSON.parse(s.slice(a, b + 1));
      if (Array.isArray(v)) return v;
    } catch {}
  }
  throw new Error("Did not return a valid JSON array");
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function planItems(
  apiKey: string,
  userRequest: string,
  model: string,
): Promise<PlanItem[]> {
  const known = planKnownDocument(userRequest);
  if (known?.length) return known;

  const sys = `You are a legal document planner for Indian law.
Output ONLY a JSON array. Each element: { "act": "<full Act name>", "id": "<Article/Section identifier>" }
- Enumerate every article/section individually for the requested document.
- If user gives a range, list only that range.
- No duplicates. Numerical order. Output JSON array only.`;
  const raw = await callGemini(apiKey, model, sys, userRequest, true);
  const arr = extractJsonArray(raw) as { act: string; id: string }[];
  const cleaned = arr
    .filter((x) => x && typeof x.act === "string" && typeof x.id === "string")
    .map((it) => ({
      act: it.act.trim(),
      id: it.id.trim(),
      filename: `${safeName(it.act)}_${safeName(it.id)}.json`,
      lawType: inferLawType("", it.act),
    }));
  if (!cleaned.length) throw new Error("Planner returned 0 items");
  return cleaned;
}

export async function fetchCatalog(apiKey: string, model: string): Promise<CatalogItem[]> {
  const sys = `You are an Indian legal knowledge cataloguer.
Output ONLY a JSON array of legal documents you (Gemini) can author detailed RAG documents for, covering:
- The Constitution of India
- All major central Acts (criminal, civil, evidence, contract, IT, companies, IPR, taxation, labour, family, environment, etc.)
- The 2023 criminal law overhaul (BNS, BNSS, BSA)
- Procedural codes
- National security laws (UAPA, NSA, AFSPA, Official Secrets Act, NIA Act, PMLA, FCRA, Telegraph Act, etc.)
- Major rules and regulations (RTI, Right to Education, etc.)

Each item MUST be:
{
  "act": "Full official Act name with year",
  "category": "Constitutional | Criminal | Civil | Procedural | National Security | Economic | IT & Cyber | Labour | Family | Environment | IPR | Tax | Other",
  "description": "1-2 line plain English description",
  "unit": "Article" | "Section",
  "count": <approximate total number of articles/sections as integer>
}
Return at least 40 items. Output ONLY the JSON array, no prose, no markdown.`;
  const raw = await callGemini(
    apiKey, model, sys,
    "List all Indian legal documents you can build RAG for.",
    true, 16384,
  );
  const arr = extractJsonArray(raw) as CatalogItem[];
  return arr
    .filter((x) => x && x.act && x.unit && Number.isFinite(Number(x.count)) && Number(x.count) > 0)
    .map((x) => ({
      ...x,
      count: Number(x.count),
      lawType: inferLawType(x.category, x.act),
    }));
}

export function catalogToPlan(item: CatalogItem): PlanItem[] {
  return buildRangePlan(item.act, item.unit, 1, item.count, item.lawType);
}

export async function generateRagDoc(
  apiKey: string,
  item: PlanItem,
  model: string,
  systemPromptOverride?: string,
): Promise<string> {
  const maxTokens = 32768;
  const systemPrompt =
    systemPromptOverride ??
    item.customPrompt ??
    PROMPT_REGISTRY[item.lawType ?? "default"]?.prompt ??
    PROMPT_REGISTRY.default.prompt;
  const userPrompt =
    `Generate the complete RAG training document for:\n\n${item.id} of ${item.act}\n\n` +
    `Return ONLY valid JSON. No markdown fences. No text before or after the JSON object.`;
  return callGemini(apiKey, model, systemPrompt, userPrompt, false, maxTokens);
}
