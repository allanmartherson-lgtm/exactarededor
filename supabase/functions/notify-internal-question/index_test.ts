// Testes unitários da lógica de roteamento de notify-internal-question.
// Foco: função pura `defaultRecipientsForCreated` + semântica do override
// `recipient_roles` + filtragem de destinatários (autor não notifica a si
// mesmo no created; responder não recebe no resolved).
//
// Não dispara email nem toca banco — usa apenas a função exportada e mocks
// inline para a lógica de seleção/filtragem de IDs.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { defaultRecipientsForCreated } from "./index.ts";

type Role = "analista" | "validador" | "diretor" | "admin";

// Replica a seleção de papéis usada na edge: override > matriz.
function resolveRoles(
  askerRole: Role | null | undefined,
  paymentStatus: string | null,
  override?: Role[],
): Role[] {
  return override?.length ? override : defaultRecipientsForCreated(askerRole, paymentStatus);
}

// Replica a filtragem do created: remove o autor da lista de destinatários.
function filterCreatedRecipients(ids: string[], authorId: string | null): string[] {
  return Array.from(new Set(ids)).filter((id) => id && id !== authorId);
}

// Replica a filtragem do resolved: notifica apenas o autor original, exceto
// quando ele é o próprio responder.
function pickResolvedRecipient(
  authorId: string | null,
  responderId: string | null,
): string[] {
  if (!authorId) return [];
  if (responderId && authorId === responderId) return [];
  return [authorId];
}

Deno.test("Cenário 1 — Validador pergunta → notifica analista", () => {
  assertEquals(defaultRecipientsForCreated("validador", "aguardando_validacao"), ["analista"]);
  assertEquals(defaultRecipientsForCreated("validador", "aguardando_aprovacao"), ["analista"]);
});

Deno.test("Cenário 2 — Diretor pergunta → notifica analista + validador", () => {
  assertEquals(defaultRecipientsForCreated("diretor", "aguardando_aprovacao"), ["analista", "validador"]);
  assertEquals(defaultRecipientsForCreated("admin", "aguardando_validacao"), ["analista", "validador"]);
});

Deno.test("Cenário 3a — Analista pergunta com lote em aguardando_aprovacao → diretor", () => {
  assertEquals(defaultRecipientsForCreated("analista", "aguardando_aprovacao"), ["diretor"]);
});

Deno.test("Cenário 3b — Analista pergunta com lote em aguardando_validacao → validador", () => {
  assertEquals(defaultRecipientsForCreated("analista", "aguardando_validacao"), ["validador"]);
});

Deno.test("Cenário 3c — Analista pergunta com status desconhecido → fallback validador", () => {
  assertEquals(defaultRecipientsForCreated("analista", "revisao_analista"), ["validador"]);
  assertEquals(defaultRecipientsForCreated(null, null), ["validador"]);
});

Deno.test("Cenário 4 — Resolved: notifica apenas o autor original", () => {
  assertEquals(pickResolvedRecipient("user-author", "user-responder"), ["user-author"]);
});

Deno.test("Cenário 4b — Resolved: responder não é notificado quando é o próprio autor", () => {
  assertEquals(pickResolvedRecipient("user-x", "user-x"), []);
});

Deno.test("Cenário 4c — Resolved: sem autor, ninguém é notificado", () => {
  assertEquals(pickResolvedRecipient(null, "user-y"), []);
});

Deno.test("Cenário 5 — Override de recipient_roles ignora a matriz", () => {
  // Mesmo que o asker seja analista (matriz daria 'validador'), override vence.
  assertEquals(resolveRoles("analista", "aguardando_validacao", ["admin"]), ["admin"]);
  // Override vazio cai na matriz.
  assertEquals(resolveRoles("validador", "aguardando_validacao", []), ["analista"]);
  // Override múltiplo é respeitado.
  assertEquals(resolveRoles("diretor", "aguardando_aprovacao", ["analista"]), ["analista"]);
});

Deno.test("Filtragem created — autor da pergunta nunca recebe a própria notificação", () => {
  const candidateIds = ["author-1", "user-2", "user-3", "user-2"];
  assertEquals(filterCreatedRecipients(candidateIds, "author-1"), ["user-2", "user-3"]);
});

Deno.test("Filtragem created — sem autor, mantém todos únicos", () => {
  assertEquals(filterCreatedRecipients(["a", "a", "b"], null), ["a", "b"]);
});
