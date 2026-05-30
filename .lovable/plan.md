# Auto-incluir novos médicos + aviso

## Problema

Regras de grupo vinculadas a empresa com **lista específica de médicos** (allowlist em `group_company_links[].doctors`) não cobrem médicos que entraram na empresa depois da criação da regra. Resultado: médicos novos ficam fora da regra silenciosamente (caso COTE).

## Decisão (já confirmada)

- **Comportamento:** Auto-incluir + aviso. Médico novo passa a ser coberto pela regra automaticamente, mas o sistema sinaliza para revisão.
- **Surfaces do aviso:** Card da regra na lista, Painel de Saúde, Notificação ao supervisor.

## Mudanças

### 1. Motor de regras — auto-inclusão (`supabase/functions/_shared/rulesEngine.ts`)

Hoje `matchDoctorInList` exige que o médico esteja na allowlist. Mudança:

- Adicionar novo campo opcional `auto_include_new_doctors: boolean` (default `true`) em cada `group_company_links[]`.
- Em `matchScope`/matching de link: se o item bate na `company_id` do link **e** o doctor não está na lista, ainda assim aplica quando `auto_include_new_doctors !== false`.
- Idem para `analyze-payment/index.ts` (filtro candidato).
- Marcar o match como `auto_included = true` para o item retornar essa info (campo informativo no `payment_items.exception_note` ou novo `match_meta`).

### 2. Detecção de "pendentes de revisão"

Função SQL `public.rule_pending_doctors(rule_id uuid)`:
- Para cada link da regra com lista não-vazia, retornar médicos de `doctor_companies` (ativos) da `company_id` que **não estão** na lista do link.
- Resultado: `{ company_id, company_name, doctor_id, full_name, crm, since }`.

Usada por:
- Card da regra (contagem)
- Painel de Saúde (lista detalhada)
- Worker de notificação

### 3. UI — Card da regra (`src/pages/Rules.tsx`)

Quando `pending_doctors_count > 0`, mostrar badge âmbar no card: `"N médico(s) novo(s) pendente(s) de revisão"`. Click abre o editor da regra na aba de empresas com os novos médicos pré-marcados em destaque.

Dentro do editor (modo "médicos específicos"), seção nova **"Médicos novos pendentes de revisão"** com cada nome + 2 botões: **Confirmar inclusão** (adiciona à allowlist) / **Excluir desta regra** (adiciona ao novo array `link.excluded_doctors` para não disparar aviso de novo).

### 4. Painel de Saúde (`src/components/rules/RulesHealthPanel.tsx`)

Nova seção **"Médicos pendentes de revisão em regras"** listando: regra → empresa → médicos novos. Botão "Revisar" leva direto ao editor.

### 5. Notificação ao supervisor

- Nova edge function `notify-rule-pending-doctors` (cron diário ou trigger ao criar `doctor_companies`).
- Usa `enqueue_notification` para enfileirar notificação aos roles `admin` e `diretor` quando há pendências.
- Debounce: agrupa por regra, no máximo 1 notificação por regra a cada 24h.

### 6. Migração (`supabase/migrations/...`)

- Função `public.rule_pending_doctors(uuid)` retornando `TABLE(...)`.
- View opcional `public.rules_health_pending` para agregação no painel.
- Sem alterar schema de `rules` (o `auto_include_new_doctors` vive dentro do JSONB `group_company_links`, já flexível).

## Ordem de execução

1. Migration: função `rule_pending_doctors`.
2. Motor (`rulesEngine.ts` + `analyze-payment`): auto-inclusão.
3. UI: badge no card + seção no editor + painel de saúde.
4. Edge function de notificação + cron.

## Fora de escopo

- Não tocamos em regras com `doctors = []` ("Todos os médicos") — já cobrem novos automaticamente.
- Não tocamos em `group_doctors` (allowlist global da regra, sem empresa) — comportamento atual mantido por enquanto; se você quiser também aplicar lá, dá pra estender depois.
