/**
 * Testes de integração para `bulk_send_groups_to_validation` cobrindo
 * concorrência e contenção de lock.
 *
 * Por que existem
 * ---------------
 * O caminho legado (UPDATE em loop client-side) deixava grupos travados em
 * `concluida_analista` quando uma das chamadas falhava silenciosamente
 * (AbortError "Lock broken by another request with the 'steal' option" no
 * refresh de token Supabase, throttling do PostgREST, navegação prematura).
 * A nova RPC SECURITY DEFINER faz tudo numa única instrução UPDATE; estes
 * testes provam, contra o banco real do preview, que mesmo sob concorrência
 * e bloqueio de linha o resultado final é determinístico — todos os grupos
 * elegíveis vão para `aguardando_validacao`, nenhum fica em status
 * intermediário.
 *
 * Estratégia
 * ----------
 * Cada teste cria sua própria conexão Postgres, semeia um pagamento + N
 * grupos numa transação efêmera (que ele mesmo limpa via DELETE em
 * `finally`), executa o cenário e checa o estado final.
 *
 * NÃO usamos `withAuthenticatedTx` aqui porque concorrência exige múltiplas
 * conexões reais (não múltiplas transações dentro da mesma conexão); usar
 * ROLLBACK também invalidaria as garantias da RPC (cada chamada precisa
 * commitar para a próxima enxergar o estado).
 *
 * Pré-requisito: `SUPABASE_DB_URL` definido (idem ao restante da suíte de
 * integração DB do projeto).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { requireDbUrl } from "./testDbHelper.ts";

interface Seeded {
  paymentId: string;
  groupIds: string[];
  hospitalId: string;
}

async function newClient(): Promise<Client> {
  const c = new Client(requireDbUrl());
  await c.connect();
  // Autentica como admin existente para bater RLS de payment_company_groups
  // e payments (UPDATE/DELETE). Sem isto, mesmo a limpeza falha com
  // "permission denied". Usa SET (sem LOCAL) porque vários cenários abrem
  // múltiplas transações na mesma conexão.
  const lookup = await c.queryObject<{ id: string }>(
    `SELECT user_id::text AS id FROM public.user_roles
      WHERE role = 'admin'::public.app_role LIMIT 1`,
  );
  if (lookup.rows.length === 0) {
    throw new Error("Nenhum admin em user_roles — testes de integração precisam de um admin no preview.");
  }
  await c.queryArray(
    `SELECT set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ sub: lookup.rows[0].id, role: "authenticated" })],
  );
  return c;
}

/** Pega um hospital existente para seeding (FK NOT NULL em payments.hospital_id). */
async function pickHospitalId(c: Client): Promise<string> {
  const r = await c.queryObject<{ id: string }>(
    `SELECT id::text AS id FROM public.hospitals ORDER BY created_at LIMIT 1`,
  );
  if (r.rows.length === 0) {
    throw new Error("Nenhum hospital cadastrado no preview — impossível semear payment de teste.");
  }
  return r.rows[0].id;
}

async function seedPaymentWithGroups(c: Client, groupCount: number): Promise<Seeded> {
  const hospitalId = await pickHospitalId(c);
  // created_by precisa ser um usuário real (FK auth.users). Reusa qualquer
  // user já existente no preview — não cria/persiste nada novo em auth.
  const userLookup = await c.queryObject<{ id: string }>(
    `SELECT user_id::text AS id FROM public.user_roles LIMIT 1`,
  );
  if (userLookup.rows.length === 0) {
    throw new Error("Nenhum user_roles no preview — impossível semear payments.created_by.");
  }
  const createdBy = userLookup.rows[0].id;

  const reference = `__test_bulk_send_${crypto.randomUUID().slice(0, 8)}`;
  const paymentRow = await c.queryObject<{ id: string }>(
    `INSERT INTO public.payments (
       hospital_id, status, analysis_mode, total_amount, items_count,
       reference, created_by
     ) VALUES ($1, 'revisao_analista'::public.payment_status, 'padrao', 0, 0, $2, $3::uuid)
     RETURNING id::text AS id`,
    [hospitalId, reference, createdBy],
  );
  const paymentId = paymentRow.rows[0].id;

  const groupIds: string[] = [];
  for (let i = 0; i < groupCount; i++) {
    const g = await c.queryObject<{ id: string }>(
      `INSERT INTO public.payment_company_groups (
         payment_id, hospital_id, company_name, status, total_amount, items_count
       ) VALUES ($1, $2, $3, 'concluida_analista'::public.payment_status, 0, 0)
       RETURNING id::text AS id`,
      [paymentId, hospitalId, `__test_co_${i}_${crypto.randomUUID().slice(0, 8)}`],
    );
    groupIds.push(g.rows[0].id);
  }
  return { paymentId, groupIds, hospitalId };
}

async function cleanup(c: Client, paymentId: string): Promise<void> {
  // ON DELETE CASCADE em payment_company_groups + observations etc. cobre
  // a limpeza. Usa try/catch tolerante porque o teste pode ter falhado
  // antes do seed completar.
  try {
    await c.queryArray(`DELETE FROM public.payment_observations WHERE payment_id = $1`, [paymentId]);
  } catch { /* noop */ }
  try {
    await c.queryArray(`DELETE FROM public.payment_company_groups WHERE payment_id = $1`, [paymentId]);
  } catch { /* noop */ }
  try {
    await c.queryArray(`DELETE FROM public.payments WHERE id = $1`, [paymentId]);
  } catch { /* noop */ }
}

async function callBulkSend(c: Client, paymentId: string, groupIds: string[]) {
  return await c.queryObject<{ updated_count: number; skipped_count: number; message: string }>(
    `SELECT * FROM public.bulk_send_groups_to_validation($1::uuid, $2::uuid[])`,
    [paymentId, groupIds],
  );
}

async function countByStatus(c: Client, paymentId: string): Promise<Record<string, number>> {
  const r = await c.queryObject<{ status: string; n: number }>(
    `SELECT status::text AS status, count(*)::int AS n
       FROM public.payment_company_groups
      WHERE payment_id = $1
      GROUP BY status`,
    [paymentId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.status] = Number(row.n);
  return out;
}

// ============================================================================
// CENÁRIO 1 — Caminho feliz
// Garante o contrato básico antes de cenários de concorrência.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: caminho feliz move todos para aguardando_validacao", async () => {
  const c = await newClient();
  let paymentId = "";
  try {
    const seed = await seedPaymentWithGroups(c, 10);
    paymentId = seed.paymentId;

    const res = await callBulkSend(c, seed.paymentId, seed.groupIds);
    assertEquals(res.rows[0].updated_count, 10);
    assertEquals(res.rows[0].skipped_count, 0);

    const counts = await countByStatus(c, seed.paymentId);
    assertEquals(counts["aguardando_validacao"] ?? 0, 10);
    assertEquals(counts["concluida_analista"] ?? 0, 0);
    assertEquals(counts["revisao_analista"] ?? 0, 0);
  } finally {
    if (paymentId) await cleanup(c, paymentId);
    await c.end();
  }
});

// ============================================================================
// CENÁRIO 2 — Concorrência: N chamadas paralelas sobre o MESMO conjunto
// O loop legado deixava grupos presos quando duas requisições competiam.
// A RPC atômica precisa garantir que o estado final tem 100% dos grupos em
// `aguardando_validacao` — independente de quantas chamadas paralelas.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: 5 chamadas paralelas no mesmo conjunto não deixam grupo travado", async () => {
  const seedClient = await newClient();
  let paymentId = "";
  const racers: Client[] = [];
  try {
    const seed = await seedPaymentWithGroups(seedClient, 20);
    paymentId = seed.paymentId;

    // 5 conexões independentes — simula múltiplas abas/clicks duplicados
    // ou retries do realtime disparando a mesma RPC.
    for (let i = 0; i < 5; i++) racers.push(await newClient());

    const results = await Promise.all(
      racers.map((rc) => callBulkSend(rc, seed.paymentId, seed.groupIds)),
    );

    // A SOMA de updated_count entre chamadas deve ser exatamente 20:
    // a primeira que pega o lock atualiza tudo; as demais veem 0
    // (status já não está mais em concluida_analista). Nenhuma falha,
    // nenhuma deixa o estado inconsistente.
    const totalUpdated = results.reduce((a, r) => a + Number(r.rows[0].updated_count), 0);
    assertEquals(totalUpdated, 20, "Soma de updates entre chamadas concorrentes deve cobrir todos os grupos exatamente uma vez");

    const counts = await countByStatus(seedClient, seed.paymentId);
    assertEquals(counts["aguardando_validacao"] ?? 0, 20, "Todos os grupos devem terminar em aguardando_validacao");
    assertEquals(counts["concluida_analista"] ?? 0, 0, "Nenhum grupo pode ficar preso em concluida_analista");
  } finally {
    for (const rc of racers) {
      try { await rc.end(); } catch { /* noop */ }
    }
    if (paymentId) await cleanup(seedClient, paymentId);
    await seedClient.end();
  }
});

// ============================================================================
// CENÁRIO 3 — Concorrência com subconjuntos sobrepostos
// Duas chamadas paralelas pedindo subconjuntos parcialmente sobrepostos
// (ex.: cliques duplicados em listas filtradas diferentes). O estado final
// precisa ser: TODO grupo presente em qualquer uma das chamadas terminou
// em `aguardando_validacao`.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: subconjuntos sobrepostos cobrem união sem perder grupos", async () => {
  const seedClient = await newClient();
  const racerA = await newClient();
  const racerB = await newClient();
  let paymentId = "";
  try {
    const seed = await seedPaymentWithGroups(seedClient, 12);
    paymentId = seed.paymentId;

    const subsetA = seed.groupIds.slice(0, 8);   // 0..7
    const subsetB = seed.groupIds.slice(4, 12);  // 4..11 (overlap em 4..7)

    const [resA, resB] = await Promise.all([
      callBulkSend(racerA, seed.paymentId, subsetA),
      callBulkSend(racerB, seed.paymentId, subsetB),
    ]);

    const totalUpdated = Number(resA.rows[0].updated_count) + Number(resB.rows[0].updated_count);
    assertEquals(totalUpdated, 12, "Soma deve cobrir a união dos subconjuntos exatamente uma vez");

    const counts = await countByStatus(seedClient, seed.paymentId);
    assertEquals(counts["aguardando_validacao"] ?? 0, 12);
    assertEquals(counts["concluida_analista"] ?? 0, 0);
  } finally {
    try { await racerA.end(); } catch { /* noop */ }
    try { await racerB.end(); } catch { /* noop */ }
    if (paymentId) await cleanup(seedClient, paymentId);
    await seedClient.end();
  }
});

// ============================================================================
// CENÁRIO 4 — Contenção de lock real
// Outra transação mantém SELECT FOR UPDATE em um dos grupos durante 1.5s.
// A RPC deve ESPERAR o lock liberar e então atualizar TUDO (incluindo a
// linha que estava locked). Comportamento errado seria: pular a linha
// travada e deixá-la presa em `concluida_analista` — o que era exatamente
// o bug do loop UPDATE em série.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: row lock concorrente não deixa o grupo travado para trás", async () => {
  // Usamos o seedClient como "lock holder": ele já provou que tem permissão
  // de escrita (acabou de inserir os grupos). Abre transação, faz UPDATE
  // segurando o lock da linha 0 e só commita após disparar a RPC numa
  // segunda conexão. Se a RPC pulasse a linha travada, ela ficaria presa em
  // concluida_analista — exatamente o bug do loop client-side antigo.
  const seedClient = await newClient();
  const racer = await newClient();
  let paymentId = "";
  let lockHeld = false;
  try {
    const seed = await seedPaymentWithGroups(seedClient, 6);
    paymentId = seed.paymentId;

    await seedClient.queryArray("BEGIN");
    lockHeld = true;
    await seedClient.queryObject(
      `UPDATE public.payment_company_groups SET updated_at = now() WHERE id = $1`,
      [seed.groupIds[0]],
    );

    // Dispara a RPC sem await — ela vai bloquear na linha travada.
    const racerPromise = callBulkSend(racer, seed.paymentId, seed.groupIds);

    // Mantém o lock por 1.5s, simulando uma transação concorrente lenta.
    await new Promise((r) => setTimeout(r, 1500));
    await seedClient.queryArray("COMMIT");
    lockHeld = false;

    const res = await racerPromise;
    assertEquals(Number(res.rows[0].updated_count), 6, "Todos os 6 grupos devem ser atualizados, incluindo o que estava locked");

    const counts = await countByStatus(racer, seed.paymentId);
    assertEquals(counts["aguardando_validacao"] ?? 0, 6);
    assertEquals(counts["concluida_analista"] ?? 0, 0, "Nenhum grupo pode ter sido pulado por causa do lock");
  } finally {
    if (lockHeld) {
      try { await seedClient.queryArray("ROLLBACK"); } catch { /* noop */ }
    }
    if (paymentId) {
      try { await cleanup(racer, paymentId); } catch { /* noop */ }
    }
    try { await racer.end(); } catch { /* noop */ }
    try { await seedClient.end(); } catch { /* noop */ }
  }
});

// ============================================================================
// CENÁRIO 5 — Idempotência
// Re-chamar a RPC depois que tudo já foi enviado deve retornar
// updated_count=0 sem erro e sem regredir nenhum status.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: segunda chamada é no-op idempotente", async () => {
  const c = await newClient();
  let paymentId = "";
  try {
    const seed = await seedPaymentWithGroups(c, 5);
    paymentId = seed.paymentId;

    const first = await callBulkSend(c, seed.paymentId, seed.groupIds);
    assertEquals(Number(first.rows[0].updated_count), 5);

    const second = await callBulkSend(c, seed.paymentId, seed.groupIds);
    assertEquals(Number(second.rows[0].updated_count), 0, "Segunda chamada não deve atualizar nada");

    const counts = await countByStatus(c, seed.paymentId);
    assertEquals(counts["aguardando_validacao"] ?? 0, 5);
  } finally {
    if (paymentId) await cleanup(c, paymentId);
    await c.end();
  }
});

// ============================================================================
// CENÁRIO 6 — Recompute do status do pagamento após RPC
// A RPC chama `recompute_payment_status_from_groups`; após executá-la, o
// `payments.status` precisa refletir o estado dos grupos (analista e
// validador veem a mesma coisa). Cobre regressão do bug em que o lote
// ficava em `revisao_analista` enquanto todos os grupos já estavam em
// `aguardando_validacao`.
// ============================================================================
Deno.test("bulk_send_groups_to_validation: payments.status reflete grupos após RPC", async () => {
  const c = await newClient();
  let paymentId = "";
  try {
    const seed = await seedPaymentWithGroups(c, 7);
    paymentId = seed.paymentId;

    await callBulkSend(c, seed.paymentId, seed.groupIds);

    const r = await c.queryObject<{ status: string }>(
      `SELECT status::text AS status FROM public.payments WHERE id = $1`,
      [seed.paymentId],
    );
    assertEquals(r.rows[0].status, "aguardando_validacao", "payments.status deve casar com o estado dos grupos");
  } finally {
    if (paymentId) await cleanup(c, paymentId);
    await c.end();
  }
});
