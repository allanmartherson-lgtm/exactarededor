import { supabase } from "@/integrations/supabase/client";

/**
 * Recompute doctor-specific exclusions após qualquer escrita em `rules`.
 *
 * O trigger `trg_sync_doctor_specific_exclusions` foi desabilitado no banco
 * (ver migration 2026-07-14) porque ele rodava DENTRO da mesma transação de
 * `apply_rule_save_with_corrections` e competia com os upserts de
 * `rule_calculations`, estourando o statement timeout de 2min em regras
 * grandes (~33 cálculos).
 *
 * Solução: chamar esta função UMA VEZ, FORA da transação pesada, após todas
 * as escritas terminarem com sucesso. Todos os fluxos que mutam `rules`
 * (save, delete, clone, restore snapshot) devem invocar isto ao final.
 *
 * Falhas são apenas logadas — o recompute pode ser reexecutado a qualquer
 * momento e não deve derrubar o fluxo principal que já persistiu com sucesso.
 */
export async function recomputeDoctorSpecificExclusions(): Promise<void> {
  try {
    const { error } = await (supabase as any).rpc("recompute_doctor_specific_exclusions");
    if (error) {
      console.warn("[recomputeDoctorSpecificExclusions] falha:", error.message);
    }
  } catch (e: any) {
    console.warn("[recomputeDoctorSpecificExclusions] exceção:", e?.message ?? e);
  }
}
