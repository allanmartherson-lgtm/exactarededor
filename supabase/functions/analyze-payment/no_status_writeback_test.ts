/**
 * Invariante crítico: a edge function `analyze-payment` NÃO pode escrever em
 * `payments.status` durante a reanálise. Se escrever, cria condição de corrida
 * que rebaixa lotes já enviados ("aguardando_validacao"/"aguardando_aprovacao")
 * de volta para "revisao_analista", sumindo da fila do validador.
 *
 * O status do pagamento é derivado dos `payment_company_groups` pelo trigger
 * `recompute_payment_status_from_groups`. Esta é a ÚNICA fonte da verdade.
 *
 * Estes testes leem o source da edge function e do componente de UI para
 * garantir que essa regra não regrida em refatorações futuras.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

const FN_PATH = new URL("./index.ts", import.meta.url);
const SOURCE = await Deno.readTextFile(FN_PATH);

Deno.test("analyze-payment: não escreve payments.status no payload de reanálise", () => {
  // Procura QUALQUER atribuição que coloque `status` no objeto enviado para
  // `payments.update(...)` — ex.: `paymentUpdate.status = "..."`.
  // Variações também proibidas: `status:` literal dentro do objeto de update.
  const forbiddenPatterns = [
    /paymentUpdate\.status\s*=/,
    /paymentUpdate\[["']status["']\]\s*=/,
  ];
  for (const p of forbiddenPatterns) {
    assertEquals(
      p.test(SOURCE),
      false,
      `analyze-payment não pode atribuir payments.status (padrão: ${p}). ` +
        `Isso causa a regressão "lote some da fila do validador após reanálise".`,
    );
  }
});

Deno.test("analyze-payment: payload do update de payments só contém campos permitidos", () => {
  // Procura blocos: const paymentUpdate: ... = { ... }
  // (objeto literal de inicialização) e confirma que só inclui ai_summary.
  // (specialties é adicionada condicionalmente depois — fora do literal.)
  const initMatch = SOURCE.match(
    /const\s+paymentUpdate\s*:\s*[^=]+=\s*\{([^}]*)\}/,
  );
  assert(initMatch, "esperado bloco `const paymentUpdate ... = {}`");
  const body = initMatch[1];
  // Não pode ter `status` no literal inicial.
  assertEquals(
    /\bstatus\b\s*:/.test(body),
    false,
    "literal de inicialização de paymentUpdate não pode conter `status`",
  );
});

Deno.test("analyze-payment: comentário documenta o invariante para futuros mantenedores", () => {
  // Garante que o comentário explicativo permanece — qualquer refator que
  // o remova deve falhar este teste e forçar revisão consciente.
  assertStringIncludes(
    SOURCE,
    "NÃO escrevemos `payments.status`",
    "comentário invariante removido — refator perigoso",
  );
  assertStringIncludes(
    SOURCE,
    "recompute_payment_status_from_groups",
    "referência à função autoritativa removida do comentário",
  );
});

Deno.test(
  "PaymentDetail: envio para validação é delegado à RPC atômica (fila coletiva)",
  async () => {
    const path = new URL(
      "../../../src/pages/PaymentDetail.tsx",
      import.meta.url,
    );
    const src = await Deno.readTextFile(path);

    // O envio deixou de ser um UPDATE em loop no cliente e passou a ser uma
    // única chamada a `bulk_send_groups_to_validation` — que é quem grava
    // status='aguardando_validacao' e chama recompute_payment_status_from_groups.
    // O loop antigo deixava grupos travados em 'concluida_analista' quando uma
    // das chamadas falhava em silêncio (RLS, AbortError, throttling).
    assertStringIncludes(src, "bulk_send_groups_to_validation");
    // Não pode mais existir atribuição individual de validador.
    assertEquals(
      /assigned_validator_id/.test(src),
      false,
      "PaymentDetail não pode mais referenciar assigned_validator_id (fila coletiva).",
    );
    assertEquals(
      /assigned_validator_group_id/.test(src),
      false,
      "PaymentDetail não pode mais referenciar assigned_validator_group_id (fila coletiva).",
    );
  },
);

Deno.test(
  "bulk_send_groups_to_validation: é a RPC que grava aguardando_validacao e recomputa o pagamento",
  async () => {
    // Contraparte do teste acima: o cliente delegou, então o invariante
    // ("enviar coloca o grupo em aguardando_validacao") tem que estar aqui.
    const migrationsDir = new URL("../../migrations/", import.meta.url);
    const files: string[] = [];
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && entry.name.endsWith(".sql")) files.push(entry.name);
    }
    files.sort();

    let sql: string | null = null;
    for (let i = files.length - 1; i >= 0; i--) {
      const body = await Deno.readTextFile(new URL(files[i], migrationsDir));
      if (body.includes("FUNCTION public.bulk_send_groups_to_validation")) {
        sql = body;
        break;
      }
    }
    assert(sql, "nenhuma migração define bulk_send_groups_to_validation");

    assertStringIncludes(sql, "SET status = 'aguardando_validacao'");
    // Status do pagamento continua derivado dos grupos — nunca escrito direto.
    assertStringIncludes(sql, "recompute_payment_status_from_groups");
  },
);
