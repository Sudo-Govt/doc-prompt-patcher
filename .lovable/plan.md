## Goal

Rebuild your Indian-legal-docs RAG generator (Bhramar RAG Builder) on this project's TanStack Start stack and fix the bugs introduced when you edited the original. The headline feature you asked for — a text button on each generated catalog item that opens an editor for the prompt used for that specific document type — will work end-to-end.

## What's broken in the upload (and how it'll be fixed)

1. `src/pages/Index.tsx` imports `PROMPT_REGISTRY` and `LawType` from `@/lib/gemini`, but neither is exported. → Build a real `PROMPT_REGISTRY` (constitution / criminal / procedural / default) in `gemini.ts` and export `LawType`.
2. `CatalogItem` is referenced as `c.lawType` in the UI but the type/API never sets it. → Add `lawType` to `CatalogItem`, infer it from category/act name in `fetchCatalog`, and include it in `catalogToPlan` output.
3. `generateRagDoc` ignores any custom prompt — the UI tries to pass one via `(p as any).__customPrompt` which is dropped. → Add a `customPrompt` parameter to `PlanItem` and have `generateRagDoc` use it when present, otherwise fall back to the registry prompt for the item's `lawType`, otherwise the default constitution prompt.
4. Code is React Router + Vite; this project is TanStack Start. → Port the page to `src/routes/index.tsx`, update head/meta, drop `react-router-dom`.

## Scope of the rebuild

Recreate the full app in this repo:

- **Routing**: single `/` page in `src/routes/index.tsx` with proper TanStack head metadata (title, description, og tags).
- **Backend**: Lovable Cloud (Supabase) for the `rag_documents` table — same schema as the upload (`id`, `batch_id`, `source_prompt`, `act`, `article_id`, `filename`, `content`, `created_at`) with RLS open for now (matches the upload's behaviour, since the app is single-user with a personal Gemini key).
- **AI calls**: keep the direct browser-to-Gemini call pattern using a key the user pastes (stored in `localStorage`, same as today). No server function needed for that path.
- **Libraries**: `jszip` for batch ZIP downloads; existing shadcn components for UI.

## Three tabs (same as before)

1. **Generate** — free-text prompt → planner → per-item generation with Pause / Resume / Stop / Retry, live progress list, individual + bulk download, auto-save to library.
2. **Catalog** — Load Catalog (Gemini-generated list of ~40+ Indian legal documents with category + unit + count), filter, generate any item with one click.
3. **Library** — saved documents grouped by batch, with per-file download, per-batch ZIP, "download all", delete.

## The per-document prompt editor (the feature you called out)

Every row in the **Catalog** tab gets two buttons next to it:

- **✏️ Prompt** — opens a dialog pre-filled with the prompt that will be used for this act:
  - if you've saved a custom prompt for this act → that text
  - else → the registry prompt for the act's `lawType` (constitution / criminal / procedural / default)
  - dialog shows a large monospace textarea, character counter, and three actions: **Cancel**, **Save prompt** (persist for later runs), **Save & Generate** (persist + start generation immediately)
- **▶ Generate** — generates using the saved custom prompt if one exists, otherwise the registry default for that `lawType`.

A small purple dot on the **✏️ Prompt** button indicates "a custom prompt is saved for this act." Custom prompts persist in `localStorage` under `rag_custom_prompts` keyed by act name.

A legend pill row above the catalog explains which built-in prompt each `lawType` uses, and each catalog row shows its `lawType` as a coloured pill (Constitution = purple, Criminal = red, Procedural = amber, General = slate).

## Prompt registry

Three full prompts ported verbatim from your upload:

- `constitution` → the v4.0 constitutional schema prompt (default fallback)
- `criminal` → criminal-law prompt
- `procedural` → procedural-law prompt
- `default` → constitution prompt (safe fallback)

`lawType` is auto-assigned in `fetchCatalog` from the category string (e.g. `Constitutional → constitution`, `Criminal | National Security → criminal`, `Procedural → procedural`, everything else → `default`).

## Technical notes

- New file: `src/server/db.server.ts` is **not** needed — Supabase calls run from the browser via `@/integrations/supabase/client`.
- `src/lib/gemini.ts` exports: `planItems`, `fetchCatalog`, `catalogToPlan`, `generateRagDoc`, `PROMPT_REGISTRY`, `inferLawType`, types `PlanItem`, `CatalogItem`, `LawType`.
- `PlanItem` gains an optional `customPrompt?: string` and `lawType?: LawType`. `generateRagDoc` resolution order: explicit arg → `item.customPrompt` → `PROMPT_REGISTRY[item.lawType]` → `PROMPT_REGISTRY.default`.
- DB migration creates `public.rag_documents` with RLS enabled and a permissive policy (single-user app); we can tighten this later if you add auth.
- Head metadata on `/`: title "Bhramar RAG Builder — Indian Legal Documents via Gemini", proper description and og tags.

## Out of scope (ask if you want these)

- Multi-user auth / per-user libraries.
- Server-side Gemini proxy (current pattern uses your pasted key directly from the browser).
- Editing prompts for free-text "Generate" runs (only catalog items get the prompt editor — same as the upload's intent).
