## Objetivo

Tornar auditável o caminho que o motor percorreu até escolher a regra/cálculo de cada item e impedir aprovação quando o motor não usou o TUSS principal como chave (cai em fallback ou regra divergente).

---

## 1. Trilha de decisão inline (UI do item)

Local: `src/components/payment-detail/ItemsDataGrid.tsx` → `CalcFormulaBlock` (logo abaixo de "Linha de cálculo" e acima de "Fórmula aplicada").

Novo bloco "Trilha de decisão" com os passos, lidos de `ai_findings.decision_fields`, `ai_findings.selection_trace`, `ai_findings.engine` e do `rule_calculations` já carregado:

```
1. TUSS principal do item     30804132 — Toracostomia
2. Função do profissional     1º Auxiliar (doctor_role)
3. Regra candidata avaliada   Cirurgia Torácica (id …) — prioridade: match
4. Cálculo aplicado           Excedente — Toracostomia (tabela_diferenciada)
5. Match de chave             TUSS principal = package_main_code ✅
   (ou) Fallback              package_main_code = 30804133 ≠ TUSS do item → motivo: pacote_absorbido
```

Cada passo com ícone ✅ / ⚠️ / ⛔, sem mexer no resto do painel. Quando há mismatch, mostra badge vermelho "TUSS principal não usado como chave" com o motivo derivado (`pacote_absorbido`, `sem_regra`, `sem_acordo`, `exclusao`, `fallback_default`).

Sinal de mismatch (puro front-end, sem mudar motor):
- item tem `procedure_code` (8d) e regra aplicada tem `package_main_code`
- e os dois não batem **ou** `applied_calc_method ∈ {sem_regra, sem_acordo}` quando havia regra candidata em `matched_rule_ids`.

---

## 2. Aba "Auditoria TUSS" no PaymentDetail

Local: `src/pages/PaymentDetail.tsx` → nova aba `Auditoria TUSS principal` ao lado das existentes.

Conteúdo:
- Lista somente itens do pagamento atual com mismatch (mesma regra de detecção do bloco inline).
- Colunas: Atendimento · Médico · Função · TUSS do item · Regra aplicada · TUSS principal da regra · Motivo do fallback · Ação.
- Ação por linha: "Abrir item no grid" e "Marcar como resolvido" (limpa a pendência depois que analista cadastrar/ajustar regra e re-rodar análise).
- Botão "Re-analisar pagamento" no topo.

---

## 3. Bloqueio via pendência

Trigger de detecção roda quando a análise termina (hook no `usePaymentDetailData` após carregar items): para cada item com mismatch, garante uma `pendencias` com `tipo = 'tuss_principal_nao_usado'`, status `aberta`, vinculada a `payment_id` e `payment_item_id`, com payload `{tuss_item, tuss_regra, regra_id, motivo}`.

Gate de aprovação:
- `src/pages/PaymentDetail.tsx` (ou hook equivalente que controla o botão Aprovar): se existir pendência aberta de tipo `tuss_principal_nao_usado` para o pagamento, desabilita "Aprovar" com tooltip "Existem itens em auditoria de TUSS principal".
- Resolução: re-análise sem mismatch fecha a pendência automaticamente (mesmo hook); analista também pode marcar `resolvida` manualmente via aba de auditoria registrando justificativa em `audit_log`.

Nenhuma alteração de schema (usa `pendencias` existente; só adiciona valor `tuss_principal_nao_usado` no enum/string `tipo`).

---

## 4. Tela global `/auditoria/tuss-principal`

Nova rota e página:
- Arquivo: `src/pages/AuditoriaTussPrincipal.tsx` + entrada em `src/App.tsx` e item de menu (se houver sidebar do admin).
- Query: pendências `tipo='tuss_principal_nao_usado'` `status='aberta'` joinadas com `payments`, `payment_items`, `rules`.
- Filtros: hospital, competência (mês/ano do pagamento), regra aplicada, médico, função, empresa.
- Tabela paginada com mesmas colunas da aba do PaymentDetail + link "Abrir pagamento".
- Indicadores no topo: total de pendências, pagamentos afetados, regras mais frequentes.
- Respeita `hospital_id` ativo (multi-tenant) via mesma policy/contexto usado nas outras telas administrativas.

---

## Detalhes técnicos

**Detecção (helper único, compartilhado entre UI inline, aba e tela global):**

```ts
// src/lib/tussPrincipalAudit.ts
export type TussMismatch = {
  reason: "pacote_absorbido" | "sem_regra" | "sem_acordo" | "exclusao" | "fallback_default" | "tuss_divergente";
  tuss_item: string | null;
  tuss_regra: string | null;
  regra_id: string | null;
};
export function detectTussMismatch(item, ruleCalc): TussMismatch | null { ... }
```

**Pendência (sem migration de schema):**
- inserção idempotente por `(payment_item_id, tipo)`;
- payload em `pendencias.metadata`;
- fechamento automático quando re-análise não detecta mais mismatch (comparação por `payment_item_id`).

**Gate de aprovação:**
- adicionar contagem `openTussAuditPendings` em `usePaymentDetailData` e propagar para o botão Aprovar.

**Arquivos previstos:**
- novo: `src/lib/tussPrincipalAudit.ts`
- novo: `src/components/payment-detail/TussPrincipalAuditTab.tsx`
- novo: `src/pages/AuditoriaTussPrincipal.tsx` + rota em `src/App.tsx`
- editar: `src/components/payment-detail/ItemsDataGrid.tsx` (bloco trilha em `CalcFormulaBlock`)
- editar: `src/pages/PaymentDetail.tsx` (nova aba + gate aprovar)
- editar: `src/hooks/usePaymentDetailData.ts` (cria/fecha pendências + contagem)

**Fora de escopo:** alterações no motor `analyze-payment` (a detecção é derivada do trace que o motor já grava); ajustes em outras regras de negócio.
