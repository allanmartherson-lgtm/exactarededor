## Objetivo

Adicionar, nas linhas de cálculo do tipo **exclusão**, uma flag opcional **"Contagiar demais itens do mesmo atendimento+data"**. Quando ativa e um item disparar a exclusão, **todos os demais itens do mesmo (atendimento, data)** também são excluídos (pagamento zerado). A exceção "equipe do titular" é aplicada quando existir **pelo menos 1 item no atendimento cujo médico pertença à lista de médicos da regra** — nesse caso, o atendimento inteiro é poupado do contágio.

Confirmado pelo usuário:
1. Basta 1 item do atendimento com médico da equipe para poupar todo o atendimento.
2. Contágio zera tudo (bônus, valor fixo, percentual — nada é pago).
3. Badge suave no grid identificando itens excluídos por contágio.

## Arquivos alterados

### Migração de banco (schema)
- `supabase/migrations/<timestamp>_add_contagio_exclusao.sql`
  - `ALTER TABLE public.rule_calculations ADD COLUMN contagia_atendimento boolean NOT NULL DEFAULT false;`
  - Comentário explicativo.

### Motor (edge function)
- `supabase/functions/analyze-payment/index.ts`
  - Ler `contagia_atendimento` no SELECT de `rule_calculations` (linha ~320).
  - **Post-pass após o cálculo principal**, antes de gravar `payment_items`:
    1. Identificar itens que foram excluídos por uma calc com `contagia_atendimento=true`. Agrupar por `(atendimento_norm, procedure_date::date)`.
    2. Para cada grupo, verificar se algum item do mesmo atendimento tem `doctor_id` pertencente à lista `rule.doctors` da regra que disparou. Se sim: pular o grupo.
    3. Caso contrário: para cada item do grupo ainda não excluído, zerar `expected_amount`, `gross_amount_calculated`, marcar `applied_calc_method='exclusao_contagio'`, `matched_rule_id` = regra origem, e gravar em `motivo_regra`/observação: `"Excluído por contágio: TUSS <origem> no mesmo atendimento"`.
  - Manter itens com médico da equipe intactos mesmo dentro do atendimento contagiado (exceção já cobre o atendimento inteiro, mas a lógica é: se houve exceção → grupo inteiro é poupado).

### UI de regras
- `src/components/rules/RuleCalculationsEditor.tsx` (ou equivalente onde o editor de calc mostra opções para `calculation_type='exclusao'`)
  - Adicionar checkbox **"Contagiar demais itens do mesmo atendimento+data"** visível apenas quando `calculation_type === 'exclusao'`.
  - Texto de ajuda: "Se marcado, todos os itens do mesmo atendimento serão excluídos. Itens de médicos listados na regra são exceção."

### Grid de itens
- `src/components/payment-detail/ItemsDataGrid.tsx`
  - Adicionar badge cinza discreto **"contágio"** com tooltip explicativo quando `applied_calc_method === 'exclusao_contagio'`.

### Tipos gerados
- `src/integrations/supabase/types.ts` — regerado automaticamente pela migração; não editar à mão.

## Regras respeitadas
- Escopo fechado — apenas os 4 arquivos acima.
- Migração descrita antes de aplicar (aguardo aprovação para rodar).
- Sem alteração em código compartilhado sensível (motor tem post-pass isolado).
- Ledger/auditoria: o motor já grava histórico via `applied_calc_method`; contágio fica rastreável.

## Perguntas restantes (mínimas)
Nenhuma — os 3 pontos foram confirmados. Ao aprovar o plano, aplico migração + código + deploy da edge function `analyze-payment`.
