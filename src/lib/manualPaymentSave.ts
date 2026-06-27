/**
 * Orquestração pura do salvamento de linhas manuais e do gate de encaminhamento.
 *
 * Extraída de `ManualPaymentEntry.tsx` para permitir testes determinísticos
 * (sem React/Supabase). A página injeta os adapters `saveRow` e `updateStatus`.
 *
 * Regra crítica: `runFinalize` só troca o status do payment quando NENHUMA
 * linha falhou no save — caso contrário, retorna `blocked` e preserva o
 * status atual (sem isso, o sistema avisava "encaminhado" sem ter salvo nada).
 */

export type SaveableRow = {
  key: string;
  dbId: string | null;
  dirty: boolean;
  /** Linha é válida quando tem empresa e valor > 0. */
  valid: boolean;
};

export type SaveOutcome = { saved: number; failed: number; skipped: number };

export type SaveAllResult<R extends SaveableRow> = SaveOutcome & {
  rows: R[];
};

/**
 * Percorre linhas e tenta salvar as `dirty` & `valid`.
 *  - `dirty=false` → ignorada (já gravada).
 *  - `dirty=true && !valid` → conta em `skipped` (falta empresa/valor).
 *  - `saveRow` retorna o novo `dbId` em sucesso ou `null` em falha.
 */
export async function runSaveAll<R extends SaveableRow>(
  rows: R[],
  saveRow: (row: R) => Promise<string | null>,
): Promise<SaveAllResult<R>> {
  let saved = 0;
  let failed = 0;
  let skipped = 0;
  const updated: R[] = [];
  for (const r of rows) {
    if (!r.dirty) {
      updated.push(r);
      continue;
    }
    if (!r.valid) {
      updated.push(r);
      skipped++;
      continue;
    }
    const newId = await saveRow(r);
    if (newId) {
      updated.push({ ...r, dbId: newId, key: newId, dirty: false });
      saved++;
    } else {
      updated.push(r);
      failed++;
    }
  }
  return { saved, failed, skipped, rows: updated };
}

export type FinalizeOutcome<R extends SaveableRow> =
  | { kind: "no_valid_rows"; rows: R[] }
  | { kind: "blocked_by_save_failure"; rows: R[]; save: SaveOutcome }
  | { kind: "status_update_failed"; rows: R[]; save: SaveOutcome; error: string }
  | { kind: "forwarded"; rows: R[]; save: SaveOutcome };

/**
 * Encaminha para validação somente quando tudo foi salvo.
 *
 *  1. Bloqueia se não há nenhuma linha válida (`validCount === 0`).
 *  2. Roda `runSaveAll`.
 *  3. Se `failed > 0` → devolve `blocked_by_save_failure` (NÃO chama updateStatus).
 *  4. Caso contrário, chama `updateStatus("aguardando_validacao")`.
 */
export async function runFinalize<R extends SaveableRow>(
  rows: R[],
  saveRow: (row: R) => Promise<string | null>,
  updateStatus: (status: string) => Promise<{ error: string | null }>,
  targetStatus = "aguardando_validacao",
): Promise<FinalizeOutcome<R>> {
  const validCount = rows.filter((r) => r.valid).length;
  if (validCount === 0) return { kind: "no_valid_rows", rows };

  const save = await runSaveAll(rows, saveRow);
  if (save.failed > 0) {
    return { kind: "blocked_by_save_failure", rows: save.rows, save };
  }
  const { error } = await updateStatus(targetStatus);
  if (error) {
    return { kind: "status_update_failed", rows: save.rows, save, error };
  }
  return { kind: "forwarded", rows: save.rows, save };
}
