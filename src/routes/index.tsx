import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  planItems, generateRagDoc, fetchCatalog, catalogToPlan, PROMPT_REGISTRY,
  type PlanItem, type CatalogItem, type LawType,
} from "@/lib/gemini";
import { supabase } from "@/integrations/supabase/client";
import {
  Download, Play, Pause, Loader2, FileText, Package, KeyRound,
  Library, Sparkles, Trash2, BookOpen, RotateCcw, RefreshCw, Square, Pencil, CheckCircle2,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bhramar RAG Builder — Indian Legal Documents via Gemini" },
      {
        name: "description",
        content:
          "Generate ultra-detailed RAG training JSON files for Indian legal articles and sections, powered by your Gemini API key.",
      },
      { property: "og:title", content: "Bhramar RAG Builder — Indian Legal Documents" },
      {
        property: "og:description",
        content: "Per-document prompt control, batch generation, and a saved library — all from your browser.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

interface DocResult {
  item: PlanItem;
  status: "pending" | "running" | "done" | "error" | "paused";
  content?: string;
  error?: string;
}

interface SavedDoc {
  id: string;
  batch_id: string;
  act: string;
  article_id: string;
  filename: string;
  content: string;
  source_prompt: string;
  created_at: string;
}

const KEY_STORE = "gemini_key";

const lawTypePill: Record<LawType, { bg: string; color: string; border: string; label: string }> = {
  constitution: { bg: "#ede9fe", color: "#6d28d9", border: "#c4b5fd", label: "📜 Constitution" },
  criminal:     { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", label: "⚖️ Criminal" },
  procedural:   { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", label: "📋 Procedural" },
  default:      { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1", label: "📄 General" },
};

function Index() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [prompt, setPrompt] = useState("Build RAG for entire Constitution of India");
  const [docs, setDocs] = useState<DocResult[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [history, setHistory] = useState<SavedDoc[]>([]);
  const [tab, setTab] = useState("generate");

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState("");

  const [promptDialog, setPromptDialog] = useState<{
    open: boolean; item: CatalogItem | null; text: string;
  }>({ open: false, item: null, text: "" });

  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});

  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const batchIdRef = useRef<string>("");
  const sourcePromptRef = useRef<string>("");

  // Hydrate from localStorage on mount (avoids SSR window access)
  useEffect(() => {
    if (typeof window === "undefined") return;
    setApiKey(localStorage.getItem(KEY_STORE) || "");
    try { setCatalog(JSON.parse(localStorage.getItem("rag_catalog") || "[]")); } catch {}
    try { setCustomPrompts(JSON.parse(localStorage.getItem("rag_custom_prompts") || "{}")); } catch {}
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && apiKey) localStorage.setItem(KEY_STORE, apiKey);
  }, [apiKey]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("rag_catalog", JSON.stringify(catalog));
  }, [catalog]);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("rag_custom_prompts", JSON.stringify(customPrompts));
  }, [customPrompts]);

  const loadHistory = async () => {
    const { data, error } = await supabase
      .from("rag_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      toast.error("Failed to load library", { description: error.message });
      return;
    }
    setHistory((data as SavedDoc[]) || []);
  };
  useEffect(() => { loadHistory(); }, []);

  const downloadText = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const downloadAll = async (items: { filename: string; content: string }[], zipName: string) => {
    const zip = new JSZip();
    items.forEach((d) => zip.file(d.filename, d.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = zipName; a.click();
    URL.revokeObjectURL(url);
  };

  const requireKey = () => {
    if (!apiKey.trim()) {
      toast.error("Missing API key", { description: "Paste your Gemini API key first." });
      return false;
    }
    return true;
  };

  const runPlan = async (plan: PlanItem[], sourcePrompt: string) => {
    const bid = crypto.randomUUID();
    batchIdRef.current = bid;
    sourcePromptRef.current = sourcePrompt;

    setDocs(plan.map((it) => ({ item: it, status: "pending" })));
    setRunning(true);
    setPaused(false);
    pauseRef.current = false;
    stopRef.current = false;
    setTab("generate");

    for (let i = 0; i < plan.length; i++) {
      if (stopRef.current) break;
      while (pauseRef.current) {
        await new Promise((r) => setTimeout(r, 300));
        if (stopRef.current) break;
      }
      if (stopRef.current) break;

      setDocs((prev) => prev.map((d, idx) => (idx === i ? { ...d, status: "running" } : d)));

      try {
        const content = await generateRagDoc(apiKey.trim(), plan[i], model);
        const { error: dbErr } = await supabase.from("rag_documents").insert({
          batch_id: bid,
          source_prompt: sourcePrompt,
          act: plan[i].act,
          article_id: plan[i].id,
          filename: plan[i].filename,
          content,
        });
        if (dbErr) console.error("DB save failed:", dbErr.message);
        setDocs((prev) =>
          prev.map((d, idx) => (idx === i ? { ...d, status: "done", content } : d)),
        );
      } catch (e: any) {
        setDocs((prev) =>
          prev.map((d, idx) => (idx === i ? { ...d, status: "error", error: e.message } : d)),
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    setRunning(false);
    setPaused(false);
    pauseRef.current = false;
    loadHistory();
  };

  const startPrompt = async () => {
    if (!requireKey() || !prompt.trim()) return;
    setPlanning(true);
    try {
      const plan = await planItems(apiKey.trim(), prompt.trim(), model);
      toast.success("Plan ready", { description: `Generating ${plan.length} document(s)...` });
      await runPlan(plan, prompt.trim());
    } catch (e: any) {
      toast.error("Planning failed", { description: e.message });
    } finally {
      setPlanning(false);
    }
  };

  const pauseResume = () => {
    if (paused) {
      pauseRef.current = false;
      setPaused(false);
      toast("Resumed");
    } else {
      pauseRef.current = true;
      setPaused(true);
      setDocs((prev) =>
        prev.map((d) => (d.status === "running" ? { ...d, status: "paused" } : d)),
      );
      toast("Paused — current item will finish");
    }
  };

  const stop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    setRunning(false);
    setPaused(false);
    toast("Stopped");
  };

  const retryItem = async (index: number) => {
    if (!requireKey()) return;
    const doc = docs[index];
    if (!doc) return;
    setDocs((prev) =>
      prev.map((d, i) => (i === index ? { ...d, status: "running", error: undefined } : d)),
    );
    try {
      const content = await generateRagDoc(apiKey.trim(), doc.item, model);
      const { error: dbErr } = await supabase.from("rag_documents").insert({
        batch_id: batchIdRef.current || crypto.randomUUID(),
        source_prompt: sourcePromptRef.current || doc.item.act,
        act: doc.item.act,
        article_id: doc.item.id,
        filename: doc.item.filename,
        content,
      });
      if (dbErr) console.error("DB save failed:", dbErr.message);
      setDocs((prev) =>
        prev.map((d, i) => (i === index ? { ...d, status: "done", content } : d)),
      );
      loadHistory();
      toast.success(`Retried: ${doc.item.id}`, { description: "Saved to library." });
    } catch (e: any) {
      setDocs((prev) =>
        prev.map((d, i) => (i === index ? { ...d, status: "error", error: e.message } : d)),
      );
      toast.error("Retry failed", { description: e.message });
    }
  };

  const generateOneFromCatalog = async (item: CatalogItem, overridePrompt?: string) => {
    if (!requireKey()) return;
    const plan = catalogToPlan(item).map((p) => ({
      ...p,
      customPrompt: overridePrompt ?? customPrompts[item.act],
    }));
    await runPlan(plan, `Catalog: ${item.act}`);
  };

  const openPromptDialog = (item: CatalogItem) => {
    const lt = item.lawType ?? "default";
    const fallback = PROMPT_REGISTRY[lt]?.prompt ?? PROMPT_REGISTRY.default.prompt;
    const existing = customPrompts[item.act] ?? fallback;
    setPromptDialog({ open: true, item, text: existing });
  };

  const saveAndGenerate = () => {
    const { item, text } = promptDialog;
    if (!item) return;
    setCustomPrompts((prev) => ({ ...prev, [item.act]: text }));
    setPromptDialog({ open: false, item: null, text: "" });
    generateOneFromCatalog(item, text);
  };

  const savePromptOnly = () => {
    const { item, text } = promptDialog;
    if (!item) return;
    setCustomPrompts((prev) => ({ ...prev, [item.act]: text }));
    setPromptDialog({ open: false, item: null, text: "" });
    toast.success("Prompt saved", { description: `Custom prompt saved for ${item.act}` });
  };

  const resetPromptToDefault = () => {
    const { item } = promptDialog;
    if (!item) return;
    const lt = item.lawType ?? "default";
    setPromptDialog((prev) => ({
      ...prev,
      text: PROMPT_REGISTRY[lt]?.prompt ?? PROMPT_REGISTRY.default.prompt,
    }));
    toast("Reverted to default prompt for this type");
  };

  const loadCatalog = async () => {
    if (!requireKey()) return;
    setCatalogLoading(true);
    try {
      const list = await fetchCatalog(apiKey.trim(), model);
      setCatalog(list);
      toast.success("Catalog loaded", { description: `${list.length} documents available.` });
    } catch (e: any) {
      toast.error("Catalog failed", { description: e.message });
    } finally {
      setCatalogLoading(false);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    const { error } = await supabase.from("rag_documents").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    setHistory((h) => h.filter((x) => x.id !== id));
  };

  const doneCount = docs.filter((d) => d.status === "done").length;
  const errorCount = docs.filter((d) => d.status === "error").length;
  const completed = docs.filter((d) => d.content);

  const historyByBatch = history.reduce<Record<string, SavedDoc[]>>((acc, d) => {
    (acc[d.batch_id] ||= []).push(d);
    return acc;
  }, {});

  const filteredCatalog = catalog.filter((c) => {
    const q = catalogFilter.toLowerCase();
    return !q || c.act.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
  });

  // Count unique generated documents per act (by article_id) from saved library
  const generatedByAct = history.reduce<Record<string, Set<string>>>((acc, d) => {
    (acc[d.act] ||= new Set()).add(d.article_id);
    return acc;
  }, {});

  const statusBadge = (d: DocResult, index: number) => {
    switch (d.status) {
      case "pending": return <Badge variant="outline" className="text-[10px]">Queued</Badge>;
      case "running": return <Badge className="gap-1 text-[10px]"><Loader2 className="h-3 w-3 animate-spin" /> Gen</Badge>;
      case "done":    return <Badge variant="secondary" className="text-[10px]">✓ Saved</Badge>;
      case "paused":  return <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400">Paused</Badge>;
      case "error":   return (
        <div className="flex items-center gap-1">
          <Badge variant="destructive" className="text-[10px]">Error</Badge>
          <Button
            size="sm" variant="ghost"
            className="h-6 px-1.5 text-[10px] text-amber-600 border border-amber-400 rounded"
            onClick={() => retryItem(index)}
            disabled={running}
          >
            <RefreshCw className="h-3 w-3 mr-0.5" /> Retry
          </Button>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-sm">B</div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Bhramar RAG Builder</h1>
              <p className="text-xs text-muted-foreground">Indian Legal Documents · Gemini · Per-doc prompts</p>
            </div>
          </div>
          {docs.length > 0 && (
            <div className="flex gap-2 items-center">
              <Badge variant="secondary">{doneCount}/{docs.length} done</Badge>
              {errorCount > 0 && <Badge variant="destructive">{errorCount} errors</Badge>}
              {paused && <Badge variant="outline" className="text-amber-600 border-amber-400">Paused</Badge>}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* API Key */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4" /> Gemini API Key
          </div>
          <div className="flex gap-2 flex-wrap">
            <Input
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono flex-1 min-w-[240px]"
            />
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            </select>
          </div>
        </Card>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="generate"><Sparkles className="h-4 w-4 mr-1" /> Generate</TabsTrigger>
            <TabsTrigger value="catalog"><BookOpen className="h-4 w-4 mr-1" /> Catalog ({catalog.length})</TabsTrigger>
            <TabsTrigger value="library"><Library className="h-4 w-4 mr-1" /> Library ({history.length})</TabsTrigger>
          </TabsList>

          {/* GENERATE */}
          <TabsContent value="generate" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" /> What to build
              </div>
              <Textarea
                placeholder="e.g. entire Constitution of India / entire BNS / Articles 12-35 of Constitution"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                className="resize-none"
              />
              <div className="flex gap-2 flex-wrap items-center">
                {!running && (
                  <Button onClick={startPrompt} disabled={planning} className="gap-2">
                    {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {planning ? "Planning..." : "Generate"}
                  </Button>
                )}
                {running && (
                  <Button onClick={pauseResume} variant="outline" className="gap-2">
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {paused ? "Resume" : "Pause"}
                  </Button>
                )}
                {running && (
                  <Button onClick={stop} variant="destructive" className="gap-2">
                    <Square className="h-4 w-4" /> Stop
                  </Button>
                )}
                {doneCount > 0 && (
                  <Button
                    onClick={() => downloadAll(
                      completed.map((d) => ({ filename: d.item.filename, content: d.content! })),
                      "rag_documents.zip",
                    )}
                    variant="secondary" className="gap-2"
                  >
                    <Package className="h-4 w-4" /> Download all ({doneCount})
                  </Button>
                )}
              </div>
            </Card>

            {docs.length > 0 && (
              <Card className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-medium">Current Run · {docs.length} items</h2>
                  <span className="text-xs text-muted-foreground">
                    {running && !paused && "Generating..."}
                    {running && paused && "Paused"}
                    {!running && "Idle"}
                  </span>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  <ul className="divide-y divide-border">
                    {docs.map((d, i) => (
                      <li key={i} className="px-4 py-2 flex items-center gap-3">
                        <div className="w-10 text-xs text-muted-foreground tabular-nums">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{d.item.id} — {d.item.act}</div>
                          {d.error && <div className="text-xs text-destructive truncate">{d.error}</div>}
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          {statusBadge(d, i)}
                        </div>
                        {d.status === "done" && d.content && (
                          <Button size="sm" variant="ghost" onClick={() => downloadText(d.item.filename, d.content!)}>
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* CATALOG */}
          <TabsContent value="catalog" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Legal Document Catalog
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Each document type uses its own specialized prompt. Click ✏️ Prompt to customize per act.
                  </p>
                </div>
                <Button onClick={loadCatalog} disabled={catalogLoading} className="gap-2">
                  {catalogLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {catalog.length ? "Refresh Catalog" : "Load Catalog"}
                </Button>
              </div>

              {catalog.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(Object.keys(PROMPT_REGISTRY) as LawType[]).map((key) => (
                      <Badge key={key} variant="outline" className="text-[10px] gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-primary opacity-60" />
                        {key}: {PROMPT_REGISTRY[key].label}
                      </Badge>
                    ))}
                  </div>
                  <Input
                    placeholder="Filter by act or category..."
                    value={catalogFilter}
                    onChange={(e) => setCatalogFilter(e.target.value)}
                  />
                </>
              )}
            </Card>

            {filteredCatalog.length > 0 && (
              <Card className="p-0 overflow-hidden">
                <div className="max-h-[65vh] overflow-y-auto">
                  <ul className="divide-y divide-border">
                    {filteredCatalog.map((c, i) => {
                      const lt: LawType = c.lawType ?? "default";
                      const hasCustom = !!customPrompts[c.act];
                      const pill = lawTypePill[lt];
                      const generated = generatedByAct[c.act]?.size ?? 0;
                      const total = c.count || 0;
                      const pct = total > 0 ? Math.min(100, Math.round((generated / total) * 100)) : 0;
                      const complete = total > 0 && generated >= total;
                      return (
                        <li key={i} className="px-4 py-3 flex items-center gap-2 flex-wrap">
                          <div className="flex-1 min-w-[200px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              {complete && (
                                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                              )}
                              <span className="text-sm font-medium">{c.act}</span>
                              <Badge variant="outline" className="text-[10px]">{c.category}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{c.count} {c.unit}s</Badge>
                              {generated > 0 && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${complete ? "border-green-500 text-green-700" : "border-primary/50 text-primary"}`}
                                >
                                  {generated}/{total} · {pct}%
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.description}</p>
                            {generated > 0 && !complete && (
                              <Progress value={pct} className="h-1 mt-1.5" />
                            )}
                          </div>
                          <span
                            className="text-[10px] font-medium whitespace-nowrap shrink-0"
                            style={{
                              padding: "2px 8px", borderRadius: 9999, border: "1px solid",
                              background: pill.bg, color: pill.color, borderColor: pill.border,
                            }}
                          >
                            {pill.label}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPromptDialog(c)}
                            className="gap-1 shrink-0 relative"
                          >
                            <Pencil className="h-3 w-3" /> Prompt
                            {hasCustom && (
                              <span
                                title="Custom prompt saved"
                                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary border border-background"
                              />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => generateOneFromCatalog(c)}
                            disabled={running}
                            className="gap-1 shrink-0"
                          >
                            <Play className="h-3 w-3" /> {complete ? "Regen" : "Generate"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Card>
            )}

            {catalog.length === 0 && !catalogLoading && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Click "Load Catalog" to fetch the full list of Indian legal documents.
              </p>
            )}
          </TabsContent>

          {/* LIBRARY */}
          <TabsContent value="library" className="space-y-4 mt-4">
            <Card className="p-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-medium">Saved Documents</h2>
                <p className="text-xs text-muted-foreground">
                  {history.length} total · auto-saved on generation · grouped by batch
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={loadHistory} className="gap-1">
                  <RotateCcw className="h-3 w-3" /> Refresh
                </Button>
                {history.length > 0 && (
                  <Button
                    size="sm" variant="secondary"
                    onClick={() => downloadAll(
                      history.map((x) => ({ filename: x.filename, content: x.content })),
                      "library_all.zip",
                    )}
                    className="gap-1"
                  >
                    <Package className="h-3 w-3" /> Download All
                  </Button>
                )}
              </div>
            </Card>

            <Card className="p-0 overflow-hidden">
              <div className="max-h-[65vh] overflow-y-auto">
                {Object.keys(historyByBatch).length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">No saved documents yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {Object.entries(historyByBatch).map(([batchId, items]) => (
                      <div key={batchId} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{items[0].source_prompt}</div>
                            <div className="text-xs text-muted-foreground">
                              {items.length} file(s) ·{" "}
                              {new Date(items[items.length - 1].created_at).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            size="sm" variant="secondary" className="gap-1 shrink-0"
                            onClick={() => downloadAll(
                              items.map((x) => ({ filename: x.filename, content: x.content })),
                              `${batchId.slice(0, 8)}.zip`,
                            )}
                          >
                            <Package className="h-4 w-4" /> ZIP
                          </Button>
                        </div>
                        <ul className="divide-y divide-border border border-border rounded-md">
                          {items.map((it) => (
                            <li key={it.id} className="px-3 py-2 flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium truncate">{it.article_id} — {it.act}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{it.filename}</div>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => downloadText(it.filename, it.content)}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteHistoryItem(it.id)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Prompt editor dialog */}
      <Dialog
        open={promptDialog.open}
        onOpenChange={(o) => !o && setPromptDialog({ open: false, item: null, text: "" })}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Prompt — {promptDialog.item?.act}</DialogTitle>
            <DialogDescription>
              This prompt will be used when generating RAG documents for this act. Edit, save,
              and generate — or just save for later.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={promptDialog.text}
            onChange={(e) => setPromptDialog((p) => ({ ...p, text: e.target.value }))}
            rows={18}
            className="w-full font-mono text-[11px] p-3 rounded-md border border-input bg-muted text-foreground leading-relaxed resize-y"
          />
          <div className="text-[11px] text-muted-foreground">
            {promptDialog.text.length} characters
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={resetPromptToDefault}>
              Reset to default
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPromptDialog({ open: false, item: null, text: "" })}
            >
              Cancel
            </Button>
            <Button variant="outline" onClick={savePromptOnly}>
              💾 Save prompt
            </Button>
            <Button onClick={saveAndGenerate} disabled={running} className="gap-2">
              <Play className="h-4 w-4" /> Save &amp; Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
