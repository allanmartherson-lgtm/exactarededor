import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato — a coluna "Esperado" precisa refletir o novo valor
 * IMEDIATAMENTE após o analista clicar em Aceitar (individual) ou
 * Aceitar em lote (via Zeev), e o valor precisa permanecer correto
 * após um F5 (reload).
 *
 * A garantia de F5 vem do próprio load() de usePaymentDetailData, que
 * busca payment_items direto do banco — se o RPC persistiu, o reload
 * mostra o mesmo valor. Aqui garantimos por inspeção que:
 *
 *  1) acceptItem faz optimistic update de expected_amount/gross_amount
 *     em setItems ANTES do load() (sem depender de realtime debounced).
 *  2) acceptItemKeepPaid alinha expected_amount ao gross_amount na UI.
 *  3) ZeevBulkManualDialog, após o RPC, refaz um SELECT dos itens
 *     afetados e passa as linhas frescas para onApplied.
 *  4) CompanyAnalysis, ao receber onBulkApplied({rows}), mescla as
 *     linhas em setItems antes de disparar load().
 *  5) load() de usePaymentDetailData sempre relê payment_items do banco
 *     ao montar / trocar :id — garantindo persistência após reload.
 */

const companyAnalysis = readFileSync(
  resolve(__dirname, "../CompanyAnalysis.tsx"),
  "utf8",
);
const zeevBulkDialog = readFileSync(
  resolve(__dirname, "../../components/copilot/ZeevBulkManualDialog.tsx"),
  "utf8",
);
const usePaymentDetailData = readFileSync(
  resolve(__dirname, "../../hooks/usePaymentDetailData.ts"),
  "utf8",
);

function extractFn(source: string, header: string): string {
  const idx = source.indexOf(header);
  if (idx < 0) throw new Error(`bloco não encontrado: ${header}`);
  // captura até o próximo "\n  };" (fechamento do arrow method dentro do componente)
  const rest = source.slice(idx);
  const end = rest.indexOf("\n  };");
  if (end < 0) throw new Error(`fechamento não encontrado para: ${header}`);
  return rest.slice(0, end + 5);
}

describe("Aceitar individual · Esperado atualiza imediatamente", () => {
  const acceptItem = extractFn(companyAnalysis, "const acceptItem = async");

  it("acceptItem faz setItems otimista antes do load()", () => {
    // setItems precisa aparecer ANTES do await load()
    const setItemsIdx = acceptItem.indexOf("setItems((prev)");
    const loadIdx = acceptItem.indexOf("await load()");
    expect(setItemsIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(-1);
    expect(setItemsIdx).toBeLessThan(loadIdx);
  });

  it("acceptItem atualiza gross_amount e expected_amount (e ai_findings.expected_amount)", () => {
    expect(acceptItem).toMatch(/gross_amount:\s*grossNovo/);
    expect(acceptItem).toMatch(/expected_amount:\s*row\.expected_amount\s*\?\?\s*grossNovo/);
    expect(acceptItem).toMatch(/ai_findings[\s\S]{0,200}expected_amount:\s*\(row\.ai_findings[^)]*\)\?\.expected_amount\s*\?\?\s*grossNovo/);
  });

  it("acceptItem marca ai_status='acatado' na UI (some da fila de pendentes)", () => {
    expect(acceptItem).toMatch(/ai_status:\s*"acatado"/);
  });

  it("acceptItemKeepPaid alinha expected_amount ao gross pago na UI", () => {
    const kp = extractFn(companyAnalysis, "const acceptItemKeepPaid = async");
    expect(kp).toMatch(/expected_amount:\s*Number\(row\.gross_amount\s*\?\?\s*0\)/);
    // Também precisa ocorrer ANTES do load()
    const setItemsIdx = kp.indexOf("setItems((prev)");
    const loadIdx = kp.indexOf("await load()");
    expect(setItemsIdx).toBeGreaterThan(-1);
    expect(setItemsIdx).toBeLessThan(loadIdx);
  });
});

describe("Aceitar em lote (Zeev) · Esperado atualiza imediatamente", () => {
  it("ZeevBulkManualDialog refaz SELECT de payment_items dos ids afetados após o RPC", () => {
    // Ordem obrigatória: rpc → select().in(ids) → onApplied
    const rpcIdx = zeevBulkDialog.indexOf('rpc("apply_zeev_bulk_manual"');
    const selectIdx = zeevBulkDialog.indexOf('.from("payment_items")');
    const onAppliedIdx = zeevBulkDialog.indexOf("onApplied?.(");
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeGreaterThan(rpcIdx);
    expect(zeevBulkDialog).toMatch(/\.in\(\s*"id"\s*,\s*ids\s*\)/);
    expect(onAppliedIdx).toBeGreaterThan(selectIdx);
  });

  it("onApplied recebe { itemIds, rows } — payload permite merge na UI sem realtime", () => {
    expect(zeevBulkDialog).toMatch(/onApplied\?\.\(\{\s*itemIds:\s*ids,\s*rows:\s*refreshedRows\s*\}\)/);
    // Tipagem também precisa aceitar o payload (evita regressão silenciosa)
    expect(zeevBulkDialog).toMatch(
      /onApplied\?:\s*\(payload\?:\s*\{\s*itemIds:\s*string\[\];\s*rows:\s*Array<Record<string,\s*unknown>>\s*\}\)\s*=>\s*void/,
    );
  });

  it("CompanyAnalysis mescla payload.rows em setItems antes de load()", () => {
    // Bloco do onBulkApplied
    const idx = companyAnalysis.indexOf("onBulkApplied={(payload)");
    expect(idx).toBeGreaterThan(-1);
    const block = companyAnalysis.slice(idx, idx + 1200);
    // Faz Map dos rows por id
    expect(block).toMatch(/new Map\(payload\.rows\.map/);
    // Aplica setItems mesclando { ...it, ...fresh }
    expect(block).toMatch(/setItems\(\(prev\)/);
    expect(block).toMatch(/\{\s*\.\.\.it,\s*\.\.\.\(fresh as object\)/);
    // setItems ANTES de load()
    const setItemsPos = block.indexOf("setItems((prev)");
    const loadPos = block.indexOf("await load()");
    expect(setItemsPos).toBeGreaterThan(-1);
    expect(loadPos).toBeGreaterThan(setItemsPos);
  });
});

describe("Persistência após reload (F5) · load() é a fonte da verdade", () => {
  it("usePaymentDetailData.load() relê payment_items direto do banco", () => {
    // Query paginada em .from("payment_items").select("*").eq("payment_id", id)
    expect(usePaymentDetailData).toMatch(
      /\.from\("payment_items"\)[\s\S]{0,200}\.select\("\*"\)[\s\S]{0,200}\.eq\("payment_id",\s*id\)/,
    );
    // load é disparado em useEffect na montagem / troca de :id
    expect(usePaymentDetailData).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]{0,120}loadGuarded\(\);/);
  });

  it("setItems no load() usa exclusivamente linhas vindas do fetch (sem mock/cache local)", () => {
    // sanitizedItems é construído a partir de rawItems = itemsRes.data
    expect(usePaymentDetailData).toMatch(/const rawItems = \(it \?\? \[\]\)/);
    expect(usePaymentDetailData).toMatch(/setItems\(sanitizedItems\)/);
  });

  it("expected_amount NÃO é gravado/derivado no client — vem do RPC/DB", () => {
    // O client apenas ESPELHA expected_amount vindo do RPC (grossNovo) ou já presente na row;
    // nunca chama supabase.from("payment_items").update({ expected_amount: ... }).
    expect(companyAnalysis).not.toMatch(/\.from\("payment_items"\)[\s\S]{0,400}\.update\(\{[^}]*expected_amount/);
  });
});
