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
  "SendForValidationPopover: confirma com assignment válido (specific|group|null)",
  async () => {
    const uiPath = new URL(
      "../../../src/components/SendForValidationPopover.tsx",
      import.meta.url,
    );
    const ui = await Deno.readTextFile(uiPath);

    // Os 3 modos precisam existir como SelectItem.
    assertStringIncludes(ui, 'value="general"');
    assertStringIncludes(ui, 'value="user"');
    assertStringIncludes(ui, 'value="group"');

    // O assignment montado precisa zerar o campo não escolhido (XOR).
    assertStringIncludes(
      ui,
      'validator_id: mode === "user" ? selectedUser : null',
    );
    assertStringIncludes(
      ui,
      'validator_group_id: mode === "group" ? selectedGroup : null',
    );
  },
);

Deno.test(
  "PaymentDetail: sendForValidation grava status=aguardando_validacao + assignment",
  async () => {
    const path = new URL(
      "../../../src/pages/PaymentDetail.tsx",
      import.meta.url,
    );
    const src = await Deno.readTextFile(path);

    // Update precisa setar exatamente esses 3 campos juntos.
    assertStringIncludes(src, 'status: "aguardando_validacao"');
    assertStringIncludes(src, "assigned_validator_id: a.validator_id");
    assertStringIncludes(src, "assigned_validator_group_id: a.validator_group_id");
  },
);
