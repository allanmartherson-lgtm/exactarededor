import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sha256Hex } from "@/lib/fileHash";
import type { IgnoredRowInfo } from "@/lib/importRowFilter";
import {
  computeReimportDiff,
  type ExistingItemRow,
  type ParsedItemRow,
  type ReimportDiff,
} from "@/lib/reimportDiff";

/**
 * Preview de diff antes de uma reimportação de base.
 *
 * A reimportação é destrutiva: apaga os payment_items e reinsere a partir da
 * planilha. Este gate monta o comparativo (adicionadas / removidas / valores
 * alterados + totais) e devolve a decisão do analista.
 *
 * Extraído de PaymentDetail, onde vivia inline, para que CompanyAnalysis —
 * que reimportava sem nenhum preview — passe pela mesma confirmação.
 *
 * Escopo: com `companyName`, o snapshot considera apenas os itens daquela PJ.
 * É o que a tela da empresa precisa, já que ela também só apaga e reinsere
 * essa PJ; sem o recorte, todos os itens das outras empresas apareceriam
 * como "removidos".
 */

export type ReimportDiffDecision = "confirm" | "cancel" | "skip";

export type ReimportDiffState = {
  diff: ReimportDiff;
  /** true = todos os arquivos batem com um sha256 já registrado no lote. */
  sha256Matched: boolean;
  /** Linhas descartadas pelo filtro de não-item (totalizadores/sem identificação). */
  ignoredRows: IgnoredRowInfo[];
  /** Mensagem da falha da última tentativa de commit (habilita "Tentar novamente"). */
  errorMessage?: string | null;
};

export type RunDiffGateOptions = {
  paymentId: string;
  files: File[];
  /** Linhas que a reimportação gravaria, já parseadas. */
  parsedRows: ParsedItemRow[];
  /** Quando presente, compara só os itens desta PJ. */
  companyName?: string | null;
  /** Linhas que o parser descartou por não serem item — exibidas no resumo. */
  ignoredRows?: IgnoredRowInfo[];
};

export function useReimportDiffGate() {
  const [diffState, setDiffState] = useState<ReimportDiffState | null>(null);
  const resolverRef = useRef<((v: ReimportDiffDecision) => void) | null>(null);
  const lastStateRef = useRef<ReimportDiffState | null>(null);

  /** Handler dos botões do modal. */
  const resolveDiff = (decision: ReimportDiffDecision) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDiffState(null);
    resolve?.(decision);
  };

  /**
   * Reabre o modal do diff exibindo o erro do commit e devolve a nova decisão
   * ("confirm" = tentar novamente). Se não houver diff anterior, resolve como
   * "cancel" para nunca deixar o chamador pendurado.
   */
  const showGateError = async (message: string): Promise<ReimportDiffDecision> => {
    const prev = lastStateRef.current;
    if (!prev) return "cancel";
    return new Promise<ReimportDiffDecision>((resolve) => {
      resolverRef.current = resolve;
      setDiffState({ ...prev, errorMessage: message });
    });
  };


  /**
   * Devolve a decisão do analista. Falha ao montar o preview NÃO bloqueia a
   * reimportação: devolve "confirm" e apenas registra o aviso, preservando o
   * comportamento original do PaymentDetail.
   */
  const runDiffGate = async (opts: RunDiffGateOptions): Promise<ReimportDiffDecision> => {
    try {
      // 1) SHA-256 dos arquivos atuais x hashes já registrados
      const currentHashes = await Promise.all(opts.files.map((f) => sha256Hex(f)));
      const { data: knownFiles } = await supabase
        .from("payment_source_files")
        .select("sha256")
        .eq("payment_id", opts.paymentId);
      const knownHashSet = new Set(
        (knownFiles ?? [])
          .map((r) => ((r as { sha256?: string | null }).sha256 ?? "").toLowerCase())
          .filter(Boolean),
      );
      const sha256Matched =
        currentHashes.length > 0 && currentHashes.every((h) => knownHashSet.has(h.toLowerCase()));

      // 2) Snapshot dos payment_items atuais (paginado)
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const existingItems = await fetchAllPaginated<ExistingItemRow>((from, to) => {
        const query = supabase
          .from("payment_items")
          .select("attendance_number,procedure_code,doctor_name,source_file_name,gross_amount")
          .eq("payment_id", opts.paymentId);
        const scoped = opts.companyName ? query.eq("company_name", opts.companyName) : query;
        return scoped.range(from, to);
      });

      // 3) Diff
      const diff = computeReimportDiff(existingItems, opts.parsedRows);

      // 4) Abre o modal e aguarda a decisão do analista
      const state: ReimportDiffState = { diff, sha256Matched, ignoredRows: opts.ignoredRows ?? [], errorMessage: null };
      lastStateRef.current = state;
      const decision = await new Promise<ReimportDiffDecision>((resolve) => {
        resolverRef.current = resolve;
        setDiffState(state);
      });
      return decision;
    } catch (diffErr) {
      // Falha no preview NÃO bloqueia a reimportação — apenas avisa e segue.
      console.warn("[reimport] falha ao montar preview do diff:", diffErr);
      setDiffState(null);
      resolverRef.current = null;
      return "confirm";
    }
  };

  return { diffState, runDiffGate, resolveDiff, showGateError };

}
