import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { type TvrResult } from "@/lib/tvr";
import { cn } from "@/lib/utils";
import * as React from "react";
import { useState } from "react";

// ============================================================================
// ReavaliarVinculosDialog — Item 6
// Permite ao analista escolher em qual PJ lançar a glosa quando o vínculo
// médico→PJ mudou desde o lote original ou quando o médico tem múltiplas PJs
// ativas (ambíguo). Não re-roda o motor: só grava override no item.
// ============================================================================
export function ReavaliarVinculosDialog({
  open,
  onOpenChange,
  results,
  doctorPjMap,
  doctorAllPjsMap,
  groupDoctorsMap,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  results: TvrResult[];
  doctorPjMap: Record<string, { company_id: string; company_name: string } | null>;
  doctorAllPjsMap: Record<string, Array<{ company_id: string; company_name: string }>>;
  groupDoctorsMap: Record<string, { full_name: string; crm: string | null }>;
  busy: boolean;
  onConfirm: (choices: Record<string, string | null>, reason: string) => void | Promise<void>;
}) {
  // Constrói lista de médicos com "situação" para reavaliar:
  //  - ambiguous: >1 PJ ativa em doctor_companies
  //  - divergent: PJ ativa única difere da PJ do lote pago (matched_company_id)
  //  - orphan: sem PJ ativa alguma
  //  - reassigned: já tem override aplicado
  const situations = React.useMemo(() => {
    const byDoctor = new Map<string, {
      doctor_id: string;
      doctor_name: string;
      items_count: number;
      lote_company_ids: Set<string>;
      lote_company_names: Set<string>;
      active_pjs: Array<{ company_id: string; company_name: string }>;
      current_override: string | null;
      already_forwarded: number;
    }>();
    for (const r of results) {
      const did = r.matched_doctor_id;
      if (!did) continue;
      if (r.excluir_do_encaminhamento) continue;
      const entry = byDoctor.get(did) ?? {
        doctor_id: did,
        doctor_name: groupDoctorsMap[did]?.full_name ?? r.medico ?? "Médico",
        items_count: 0,
        lote_company_ids: new Set<string>(),
        lote_company_names: new Set<string>(),
        active_pjs: doctorAllPjsMap[did] ?? [],
        current_override: r.retroactive_target_company_id ?? null,
        already_forwarded: 0,
      };
      entry.items_count += 1;
      if (r._generatedAdjustmentId) entry.already_forwarded += 1;
      if (r.matched_company_id) entry.lote_company_ids.add(r.matched_company_id);
      if (r.pj_conciliada) entry.lote_company_names.add(r.pj_conciliada);
      // Override mais recente vence (todos itens do mesmo doctor devem ter o mesmo)
      if (r.retroactive_target_company_id) entry.current_override = r.retroactive_target_company_id;
      byDoctor.set(did, entry);
    }
    type Row = {
      doctor_id: string;
      doctor_name: string;
      items_count: number;
      already_forwarded: number;
      lote_company_ids: string[];
      lote_company_names: string[];
      active_pjs: Array<{ company_id: string; company_name: string }>;
      active_single: { company_id: string; company_name: string } | null;
      current_override: string | null;
      status: "ambiguous" | "divergent" | "orphan" | "reassigned" | "ok";
    };
    const rows: Row[] = [];
    for (const [did, e] of byDoctor) {
      const single = doctorPjMap[did] ?? null;
      const loteIds = Array.from(e.lote_company_ids);
      let status: Row["status"] = "ok";
      if (e.current_override) status = "reassigned";
      else if (e.active_pjs.length > 1) status = "ambiguous";
      else if (e.active_pjs.length === 0) status = "orphan";
      else if (single && loteIds.length > 0 && !loteIds.includes(single.company_id)) status = "divergent";
      rows.push({
        doctor_id: did,
        doctor_name: e.doctor_name,
        items_count: e.items_count,
        already_forwarded: e.already_forwarded,
        lote_company_ids: loteIds,
        lote_company_names: Array.from(e.lote_company_names),
        active_pjs: e.active_pjs,
        active_single: single,
        current_override: e.current_override,
        status,
      });
    }
    // Prioriza os que precisam de decisão
    const order: Record<Row["status"], number> = { ambiguous: 0, divergent: 1, orphan: 2, reassigned: 3, ok: 4 };
    rows.sort((a, b) => order[a.status] - order[b.status] || a.doctor_name.localeCompare(b.doctor_name));
    return rows;
  }, [results, doctorPjMap, doctorAllPjsMap, groupDoctorsMap]);

  const needsAttention = situations.filter((s) => s.status !== "ok");
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState("");

  React.useEffect(() => {
    if (open) {
      // Pré-carrega escolhas com o override atual (se houver)
      const initial: Record<string, string | null> = {};
      for (const s of situations) {
        if (s.current_override) initial[s.doctor_id] = s.current_override;
      }
      setChoices(initial);
      setReason("");
    }
  }, [open, situations]);

  const dirty = Object.keys(choices).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Reavaliar vínculos médico → PJ</DialogTitle>
          <DialogDescription>
            Quando o vínculo mudou desde o lote original ou o médico tem mais de uma PJ ativa,
            escolha aqui em qual PJ a glosa deve ser lançada. Não re-roda o motor — só grava o
            destino do encaminhamento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {needsAttention.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Nenhum médico com vínculo ambíguo ou divergente entre lote e cadastro atual.
            </div>
          )}
          {needsAttention.map((s) => {
            const currentChoice = choices[s.doctor_id] ?? null;
            const loteOptions = s.lote_company_ids
              .filter((cid) => !s.active_pjs.some((p) => p.company_id === cid))
              .map((cid, i) => ({
                company_id: cid,
                company_name: s.lote_company_names[i] ?? "PJ do lote original",
              }));
            const allOptions = [...s.active_pjs, ...loteOptions];
            const statusLabel: Record<typeof s.status, string> = {
              ambiguous: `${s.active_pjs.length} PJs ativas — escolha uma`,
              divergent: "PJ do lote difere da ativa hoje",
              orphan: "Sem PJ ativa no cadastro",
              reassigned: "Já reatribuído — pode alterar",
              ok: "OK",
            };
            const statusTone: Record<typeof s.status, string> = {
              ambiguous: "bg-amber-100 text-amber-800 border-amber-300",
              divergent: "bg-blue-100 text-blue-800 border-blue-300",
              orphan: "bg-red-100 text-red-800 border-red-300",
              reassigned: "bg-emerald-100 text-emerald-800 border-emerald-300",
              ok: "bg-muted text-muted-foreground border-border",
            };
            return (
              <div key={s.doctor_id} className="rounded-lg border border-border p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{s.doctor_name}</span>
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border", statusTone[s.status])}>
                    {statusLabel[s.status]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.items_count} item(ns){s.already_forwarded > 0 ? ` · ${s.already_forwarded} já encaminhado(s) — não afetados` : ""}
                  </span>
                </div>
                {allOptions.length === 0 ? (
                  <div className="text-xs text-red-700">
                    Nenhuma PJ disponível. Cadastre um vínculo médico→PJ antes de gerar a glosa.
                  </div>
                ) : (
                  <RadioGroup
                    value={currentChoice ?? "__none__"}
                    onValueChange={(v) =>
                      setChoices((prev) => ({ ...prev, [s.doctor_id]: v === "__none__" ? null : v }))
                    }
                    className="space-y-1"
                  >
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <RadioGroupItem value="__none__" id={`${s.doctor_id}-none`} />
                      <span className="text-muted-foreground">Manter automático (PJ ativa única, quando houver)</span>
                    </label>
                    {allOptions.map((opt) => {
                      const isActive = s.active_pjs.some((p) => p.company_id === opt.company_id);
                      const isLote = s.lote_company_ids.includes(opt.company_id);
                      return (
                        <label key={opt.company_id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <RadioGroupItem value={opt.company_id} id={`${s.doctor_id}-${opt.company_id}`} />
                          <span className="font-medium">{opt.company_name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">PJ ativa</span>
                          )}
                          {isLote && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">PJ do lote</span>
                          )}
                        </label>
                      );
                    })}
                  </RadioGroup>
                )}
              </div>
            );
          })}
        </div>

        {needsAttention.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-xs">Motivo da reatribuição (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: médico trocou de PJ em jun/26; PJ anterior encerrada; contrato revisado…"
              rows={2}
              className="text-xs"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(choices, reason)}
            disabled={busy || !dirty || needsAttention.length === 0}
          >
            {busy ? "Aplicando…" : "Aplicar reatribuições"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



