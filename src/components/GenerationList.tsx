// src/components/GenerationList.tsx
import { useMemo, useState } from "react";
import { Check, Loader2, Circle, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  preflight,
  runGeneration,
  summarize,
  type GenerationItem,
  type GenerateFn,
} from "@/lib/generationRunner";
import { deleteByHash } from "@/lib/generatedDocsRepo";

type Props = {
  initialItems: GenerationItem[];
  generate: GenerateFn;
};

export function GenerationList({ initialItems, generate }: Props) {
  const [items, setItems] = useState<GenerationItem[]>(initialItems);
  const [running, setRunning] = useState(false);
  const [preflighted, setPreflighted] = useState(false);

  const summary = useMemo(() => summarize(items), [items]);

  const refresh = () => setItems((arr) => arr.slice());

  async function handleGenerate() {
    setRunning(true);
    try {
      if (!preflighted) {
        await preflight(items);
        setPreflighted(true);
        refresh();
      }
      await runGeneration(items, generate, refresh);
    } finally {
      setRunning(false);
    }
  }

  async function handleRegenerate(item: GenerationItem) {
    if (item.inputHash) {
      try {
        await deleteByHash(item.inputHash);
      } catch {
        /* ignore — will overwrite via upsert anyway */
      }
    }
    item.forceRegenerate = true;
    item.status = "queued";
    item.existing = undefined;
    refresh();
    setRunning(true);
    try {
      await runGeneration([item], generate, refresh);
    } finally {
      setRunning(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {preflighted
              ? `${summary.queued} to generate · ${summary.skipped} already built`
              : `${summary.total} document${summary.total === 1 ? "" : "s"} ready`}
          </p>
          <Button onClick={handleGenerate} disabled={running || items.length === 0}>
            {running
              ? "Generating…"
              : preflighted && summary.queued === 0
                ? "All up to date"
                : `Generate${preflighted ? ` ${summary.queued}` : ""}`}
          </Button>
        </div>

        <ul className="divide-y rounded-md border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <StatusIcon item={item} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.filename}</p>
                <p className="text-xs text-muted-foreground">
                  <StatusLabel item={item} />
                </p>
              </div>
              {(item.status === "already-generated" || item.status === "done") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRegenerate(item)}
                  disabled={running}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Regenerate
                </Button>
              )}
              {item.status === "failed" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRegenerate(item)}
                  disabled={running}
                >
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </TooltipProvider>
  );
}

function StatusIcon({ item }: { item: GenerationItem }) {
  switch (item.status) {
    case "already-generated":
    case "done":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
              <Check className="h-4 w-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {item.generatedAt
              ? `Generated ${new Date(item.generatedAt).toLocaleString()}`
              : "Generated"}
          </TooltipContent>
        </Tooltip>
      );
    case "generating":
      return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    case "failed":
      return (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <X className="h-4 w-4" />
        </span>
      );
    case "queued":
    case "idle":
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/50" />;
  }
}

function StatusLabel({ item }: { item: GenerationItem }) {
  switch (item.status) {
    case "already-generated":
      return <>Already generated — will skip</>;
    case "done":
      return <>Generated just now</>;
    case "generating":
      return <>Generating…</>;
    case "failed":
      return <>Failed: {item.error ?? "unknown error"}</>;
    case "queued":
      return <>Queued</>;
    default:
      return <>Ready</>;
  }
}
