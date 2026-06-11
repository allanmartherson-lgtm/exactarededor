/**
 * Hook para ler / salvar / aplicar templates de mapeamento de colunas.
 * Cada template é identificado por (hospital_id, header_signature) — duas
 * planilhas com a mesma assinatura de headers compartilham o mesmo template.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeHeaderSignature, type ManualMapping } from "@/lib/columnMapping";

export interface SheetColumnTemplate {
  id: string;
  hospital_id: string | null;
  name: string;
  header_signature: string;
  headers: string[];
  mapping: ManualMapping;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

export function useSheetColumnTemplates(hospitalId: string | null) {
  const [templates, setTemplates] = useState<SheetColumnTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("sheet_column_templates" as never).select("*").order("use_count", { ascending: false });
    if (hospitalId) {
      // hospital atual + globais
      q = q.or(`hospital_id.eq.${hospitalId},hospital_id.is.null`);
    } else {
      q = q.is("hospital_id", null);
    }
    const { data, error } = await q;
    if (!error && data) setTemplates(data as unknown as SheetColumnTemplate[]);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { void load(); }, [load]);

  /** Procura template aplicável aos headers da planilha. */
  const findMatching = useCallback(
    async (headers: string[]): Promise<SheetColumnTemplate | null> => {
      const sig = await computeHeaderSignature(headers);
      // prioridade: template do hospital atual > global
      const local = templates.find((t) => t.header_signature === sig && t.hospital_id === hospitalId);
      if (local) return local;
      const global = templates.find((t) => t.header_signature === sig && t.hospital_id === null);
      return global ?? null;
    },
    [templates, hospitalId],
  );

  const markUsed = useCallback(async (templateId: string) => {
    const existing = templates.find((t) => t.id === templateId);
    if (!existing) return;
    await supabase
      .from("sheet_column_templates" as never)
      .update({ use_count: existing.use_count + 1, last_used_at: new Date().toISOString() } as never)
      .eq("id", templateId);
  }, [templates]);

  const save = useCallback(
    async (params: {
      name: string;
      headers: string[];
      mapping: ManualMapping;
      scope: "hospital" | "global";
    }): Promise<{ ok: boolean; error?: string }> => {
      const signature = await computeHeaderSignature(params.headers);
      const targetHospital = params.scope === "hospital" ? hospitalId : null;
      const { error } = await supabase
        .from("sheet_column_templates" as never)
        .upsert(
          {
            hospital_id: targetHospital,
            name: params.name,
            header_signature: signature,
            headers: params.headers,
            mapping: params.mapping,
            use_count: 1,
            last_used_at: new Date().toISOString(),
          } as never,
          { onConflict: "hospital_id,header_signature" } as never,
        );
      if (error) return { ok: false, error: error.message };
      await load();
      return { ok: true };
    },
    [hospitalId, load],
  );

  return { templates, loading, reload: load, findMatching, markUsed, save };
}
