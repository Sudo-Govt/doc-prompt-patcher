// src/lib/generatedDocsRepo.ts
import { supabase } from "@/integrations/supabase/client"; // adjust to your client path

export type GeneratedDocRow = {
  id: string;
  user_id: string;
  list_item_id: string;
  input_hash: string;
  filename: string;
  output_path: string;
  prompt_version: string | null;
  generated_at: string;
};

/** Returns a Map keyed by input_hash for the given user. */
export async function fetchExistingByHashes(
  hashes: string[],
): Promise<Map<string, GeneratedDocRow>> {
  const map = new Map<string, GeneratedDocRow>();
  if (hashes.length === 0) return map;

  const { data, error } = await supabase
    .from("generated_documents")
    .select("*")
    .in("input_hash", hashes);

  if (error) throw error;
  for (const row of (data ?? []) as GeneratedDocRow[]) map.set(row.input_hash, row);
  return map;
}

export async function recordGeneratedDoc(row: {
  list_item_id: string;
  input_hash: string;
  filename: string;
  output_path: string;
  prompt_version?: string;
}) {
  const { data: userRes } = await supabase.auth.getUser();
  const user_id = userRes.user?.id;
  if (!user_id) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("generated_documents")
    .upsert(
      { ...row, user_id, prompt_version: row.prompt_version ?? null },
      { onConflict: "user_id,input_hash" },
    );
  if (error) throw error;
}

export async function deleteByHash(input_hash: string) {
  const { error } = await supabase
    .from("generated_documents")
    .delete()
    .eq("input_hash", input_hash);
  if (error) throw error;
}
