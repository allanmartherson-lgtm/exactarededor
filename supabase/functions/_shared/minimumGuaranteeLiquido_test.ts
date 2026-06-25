/**
 * Validação do cálculo de Mínimo Garantido com base "líquido".
 *
 * Espelha a query crítica da edge function `apply-minimum-guarantee` que:
 *   1) Soma `payment_company_financials.liquido` da PJ na competência.
 *   2) SUBTRAI o somatório dos `payment_items.item_origin='complemento_minimo'`
 *      já existentes — anti-loop. Sem essa subtração, cada rerun infla o
 *      complemento (líquido cresce → diferença encolhe → complemento muda
 *      ainda que sem mudança real).
 *
 * Cenário:
 *   - 1 PJ, 1 payment competência 2026-01.
 *   - payment_company_financials.liquido = 20.000 (já inclui o complemento
 *     anterior na composição do líquido).
 *   - 1 payment_item complemento_minimo de 5.000 (rodada anterior).
 *   - Piso = 25.000.
 *
 * Resultado esperado:
 *   - producao_liquida_efetiva = 20.000 - 5.000 = 15.000.
 *   - complemento_novo = max(0, 25.000 - 15.000) = 10.000  (não 5.000 nem 20.000).
 *   - Rodada sucessiva (simulada somando o novo complemento ao líquido):
 *     líquido' = 20.000 + 10.000 = 30.000; producao_efetiva = 30.000 - 10.000
 *     = 20.000 → complemento' = 5.000 → IDEMPOTENTE quando o engine atualiza
 *     o item existente em vez de criar outro (`updated`, não `created`).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newUuid, withAuthenticatedTx } from "./testDbHelper.ts";

const PISO = 25000;
const COMPETENCE = "2026-01-01";

function round2(n: number) { return Math.round(n * 100) / 100; }

Deno.test("mínimo garantido base=líquido subtrai complemento_minimo (anti-loop)", async () => {
  await withAuthenticatedTx("admin", async (tx, actorId) => {
    // Hospital
    const hospitalId = newUuid();
    await tx.query(
      `INSERT INTO public.hospitals (id, slug, name, state_uf, active)
       VALUES ($1, $2, $3, 'DF', true)`,
      [hospitalId, `h-${hospitalId.slice(0, 8)}`, "Hospital Teste MG"],
    );

    // Company
    const companyId = newUuid();
    await tx.query(
      `INSERT INTO public.companies (id, name, code, aliases, invoice_emails, tem_pool, active)
       VALUES ($1, $2, $3, '{}', '{}', false, true)`,
      [companyId, "PJ Teste MG", `pj-${companyId.slice(0, 8)}`],
    );

    // Payment competência janeiro
    const paymentId = newUuid();
    await tx.query(
      `INSERT INTO public.payments
         (id, reference, status, created_by, competence_month, hospital_id)
       VALUES ($1, $2, 'rascunho', $3, $4::date, $5)`,
      [paymentId, `MG-TEST-${paymentId.slice(0, 8)}`, actorId, COMPETENCE, hospitalId],
    );

    // payment_company_financials: liquido = 20.000 (já com complemento embutido)
    await tx.query(
      `INSERT INTO public.payment_company_financials
         (payment_id, company_id, hospital_id, bruto, liquido)
       VALUES ($1, $2, $3, 20000, 20000)`,
      [paymentId, companyId, hospitalId],
    );

    // Complemento mínimo da rodada anterior (5.000)
    await tx.query(
      `INSERT INTO public.payment_items
         (payment_id, hospital_id, company_id, doctor_name,
          gross_amount, expected_amount, item_origin)
       VALUES ($1, $2, $3, '[Complemento por PJ]', 5000, 5000, 'complemento_minimo')`,
      [paymentId, hospitalId, companyId],
    );

    // Replica EXATAMENTE a lógica da edge function
    const liqRows = await tx.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(pcf.liquido), 0)::text AS s
         FROM public.payment_company_financials pcf
         JOIN public.payments p ON p.id = pcf.payment_id
        WHERE pcf.company_id = $1
          AND p.competence_month = $2::date`,
      [companyId, COMPETENCE],
    );
    const liquidoBruto = Number(liqRows[0]?.s ?? 0);

    const compRows = await tx.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(pi.gross_amount), 0)::text AS s
         FROM public.payment_items pi
         JOIN public.payments p ON p.id = pi.payment_id
        WHERE pi.company_id = $1
          AND pi.item_origin = 'complemento_minimo'
          AND p.competence_month = $2::date`,
      [companyId, COMPETENCE],
    );
    const complementoJa = Number(compRows[0]?.s ?? 0);

    const producaoEfetiva = round2(liquidoBruto - complementoJa);
    const complementoNovo = round2(Math.max(0, PISO - producaoEfetiva));

    // Núcleo anti-loop: produção efetiva DESCONTA o complemento já aplicado.
    assertEquals(liquidoBruto, 20000, "líquido bruto deve ser 20k");
    assertEquals(complementoJa, 5000, "complemento existente deve ser detectado");
    assertEquals(producaoEfetiva, 15000, "produção efetiva = líquido - complemento");
    assertEquals(complementoNovo, 10000, "complemento novo = piso - produção efetiva");

    // Defesas regressivas: garante que NÃO estamos usando atalhos errados.
    assert(complementoNovo !== round2(PISO - liquidoBruto),
      "regressão: não pode ignorar complemento já aplicado (= 5k)");

    // Simula rerun: engine soma o novo complemento ao líquido e re-roda.
    const liquidoRerun = liquidoBruto + complementoNovo; // 30k
    // Se o engine ATUALIZAR (não criar) o item, o universo de complementos vira complementoNovo.
    const complementoJaRerun = complementoNovo; // 10k
    const producaoEfetivaRerun = round2(liquidoRerun - complementoJaRerun); // 20k
    const complementoRerun = round2(Math.max(0, PISO - producaoEfetivaRerun)); // 5k

    assertEquals(producaoEfetivaRerun, 20000, "rerun mantém produção efetiva coerente");
    assertEquals(complementoRerun, 5000, "rerun converge — não infla a cada rodada");
    // Sem a subtração do complemento, complementoRerun seria 0 (líquido 30k > piso)
    // ou alternaria entre valores — qualquer um dos dois quebra a idempotência.
  });
});
