
# Zeev v2 — Copiloto global de cadastro e lançamento

Hoje o Zeev é reativo, escopado a um pagamento, e só sabe mexer em setor / centro de custos / vínculo médico→PJ. A meta é torná-lo um copiloto que (1) entende em qual tela você está, (2) abre o lote já dizendo o que falta, (3) cria cadastros que faltam dentro do chat e (4) encurta o caminho dos lançamentos retroativos — sempre com confirmação humana e aprendendo com suas escolhas.

A entrega é faseada para você já colher valor na primeira semana enquanto roda os retroativos.

---

## Fase 1 — Pre-flight do lote + diagnóstico proativo (esta semana)

Quando você abre um pagamento, o Zeev aparece com um card "Diagnóstico do lote" agrupando tudo que falta resolver, na ordem certa:

```
Lote BRADESCO 05/2025 — 482 itens
├─ 47 sem setor             [Resolver setor →]
├─ 12 sem centro de custos  [Resolver CC →]
├─ 8  médicos sem PJ        [Vincular →]
├─ 23 sem_regra (5 padrões) [Ver padrões →]
└─ 4  divergências repetidas do mesmo TUSS  [Investigar →]
```

Cada bloco abre o fluxo de mutação em lote já existente, mas com 1 clique por etapa em vez de você digitar o pedido. O número é calculado pelos mesmos agregados que o `zeev-executor` já faz, só que pré-computados e exibidos sem prompt.

---

## Fase 2 — Cadastros faltantes resolvidos dentro do chat

Quatro novas ações para o `zeev-executor`, todas com card de confirmação + audit_log + grava alias automaticamente (já é a regra do sistema):

1. **`register_doctor_pending`** — Zeev detecta nome novo, pergunta CRM/UF/CPF/PJ provisória num único form, cria `doctors` com `status='pending'` + `doctor_aliases`. Admin aprova depois em /medicos (gate atual continua valendo).
2. **`resolve_registry_match`** — Para convênio/setor/CC sem match: card mostra "criar novo" ou "vincular a existente" (lista candidatos via `registryLookup`). Vincular grava `*_aliases`; criar abre form curto.
3. **`register_company`** — CNPJ novo: Zeev valida dígito, pré-preenche razão social (entrada manual; sem chamada externa por ora), cria `companies` e oferece "vincular médicos X, Y, Z deste lote".
4. **`propose_rule_from_pattern`** — Quando ≥3 itens caem em `sem_regra` com mesma `(convenio, procedure_code, função)`, Zeev sugere abrir o wizard de regra já pré-preenchido com esse trio. Não cria regra sozinho — só navega com state.

---

## Fase 3 — Lançamento guiado + retroativos em lote

1. **`new_payment` (escopo global)** — comandos tipo "novo lançamento Bradesco maio/2025" abrem o wizard de NewManualPayment com hospital/convênio/competência já preenchidos. Se você anexar arquivo no chat, o Zeev encaminha pro parser e cai no fluxo normal.
2. **`retroactive_batch`** — Zeev olha `payments` do hospital ativo, detecta gaps de competência por convênio, e propõe "criar os 7 lançamentos faltantes em modo histórico". Você confirma a lista; ele dispara um por um respeitando o modo seco (`import_mode='historico'`, não grava aliases auto — já é a regra constraints/historico-modo-seco).

Transições de status (em_confeccao → validação, etc.) ficam de fora desta fase: o trigger DB existente bloqueia salto, então o Zeev só sugere o botão certo via `navigate`, sem mutar.

---

## Fase 4 — Memória híbrida (aprende + você revisa)

- Toda ação aceita vira evento em `learned_pattern_events` com o `scope` que o Zeev usou (ex.: `{convenio:'bradesco', action:'set_cost_center', value:'P12-CIR'}`).
- A partir de N=3 confirmações iguais, vira `learned_patterns` com `confidence='high'`.
- Antes de propor, o Zeev consulta `learned_patterns` do hospital ativo e prioriza payload aprendido. O card mostra badge "Sugerido pelo seu histórico (8 confirmações)".
- Página nova `/copilot/learned` (admin) lista padrões aprendidos, com toggle ativar/desativar e botão "esquecer". Sem auto-aplicar — sempre confirma.

---

## Fase 5 — Escopo global com contexto de rota

- `current_path` já é enviado; vou expandir o `SYSTEM_PROMPT` com um mapa de capacidades por rota (ex.: em `/pendencias`, ações disponíveis são `assign_analyst`, `bulk_close_pendencia`; em `/regras`, `propose_rule_from_pattern`).
- Cada rota expõe um `routeContext` (agregados próprios) que o `zeev-executor` injeta no contexto da LLM, igual ao `buildPaymentAggregates` faz hoje pro pagamento.
- O componente flutuante do Zeev passa a viver no layout raiz (não só dentro do detalhe do pagamento).

---

## Detalhes técnicos

**Backend (`supabase/functions/zeev-executor`)**
- Novas actions na whitelist: `register_doctor_pending`, `resolve_registry_match`, `register_company`, `propose_rule_from_pattern`, `new_payment`, `retroactive_batch`.
- Novo helper `buildRouteContext(path, sb)` com switch por rota, devolvendo agregados específicos.
- Cada `execX` continua gravando `audit_log.diff` com before/after pra rollback.
- Memória: nova função `loadLearnedPreferences(sb, hospitalId, scope)` consultada antes do `callLLM`, injetada no contexto.

**Banco**
- Reusar `learned_patterns` / `learned_pattern_events` (já existem). Adicionar coluna `source='zeev'` se ainda não houver, pra distinguir dos padrões de regra.
- Nada de tabela nova para "diagnóstico" — é tudo derivado em runtime.

**Frontend**
- `src/components/copilot/ZeevDiagnosticCard.tsx` — card de pre-flight no topo do PaymentConciliationModal e no PaymentDetail.
- `src/components/copilot/ZeevRegistryForm.tsx` — forms curtos pros 4 cadastros (reutiliza `DoctorCombobox`, `CompanyCombobox`, etc.).
- Mover o launcher do Zeev pro layout raiz; manter o painel atual com `payment_id` quando estiver dentro do lote.
- Página `/copilot/learned` — lista, toggle, esquecer.

**Segurança**
- Toda nova action exige role interna (`analista|validador|diretor|admin`). Portal users continuam bloqueados pelo `is_portal_user` check do executor.
- `register_company` e `register_doctor_pending` exigem `analista+`; nada de auto-aprovação.

---

## Ordem de entrega proposta

1. **Fase 1** (pre-flight + diagnóstico) — você já sente alívio nos retroativos imediatamente.
2. **Fase 3.2** (retroativos em lote) — desbloqueia o trabalho atual.
3. **Fase 2** (cadastros no chat) — encurta o ciclo médio.
4. **Fase 5** (escopo global) — depois que as ações estão sólidas.
5. **Fase 4** (memória) — por último, alimentada pelos eventos já gravados nas fases anteriores.

Posso começar pela Fase 1 + 3.2 num único ciclo se você confirmar.
