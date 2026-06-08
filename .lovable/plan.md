# KPI Valor Ajustado por Intervenção

## Objetivo
Mensurar o **impacto financeiro líquido em R$** das devoluções/reprovações feitas por diretor e supervisor: quanto o hospital economizou (ou perdeu) porque a intervenção forçou o analista a corrigir o valor pago.

## Definições acordadas
- **Evento gatilho**: devolução ao analista (`payment_observations.status_to = 'devolvido_analista'`) **ou** reprovação item-a-item (observação com `item_id` preenchido) feita por usuário com papel `diretor` ou `supervisor`.
- **Fórmula**: `ajuste = valor_regra (motor) − valor_pago_final`
  - `valor_regra` = `payment_items.expected_amount` (vindo do motor)
  - `valor_pago_final` = `payment_items.gross_amount` após o analista aceitar (`acatado_at` posterior à observação)
- **Sinal (positivo = bom p/ hospital)**: `+R$` quando o pagamento final ficou ≤ o que o motor recomendava (economia). `−R$` quando o ajuste favoreceu o médico.
- **Atribuição**: detalhe granular por usuário (autor da observação) + agregado por papel nos KPIs.

## Critério de elegibilidade do item
Item entra na conta quando **todas** as condições valem:
1. Existe `payment_observations` com `item_id = item.id` **ou** `company_group_id` cobrindo o item, criada por user com role diretor/supervisor, `status_to='devolvido_analista'` ou observação de reprovação.
2. Item tem `acatado_at IS NOT NULL` e `acatado_at > observação.created_at` (analista mexeu depois da intervenção).
3. `expected_amount` e `gross_amount` ambos > 0.
4. Pagamento já está em status terminal (`pago`, `arquivado`, `aprovado`) — senão é ajuste em aberto.

## Backend (1 migration)
RPC `get_intervention_savings(p_start date, p_end date, p_hospital_id uuid)` retornando:
- Linha agregada: `total_economia`, `total_perda`, `saldo_liquido`, `itens_ajustados`, `por_papel jsonb`
- Linha por usuário: `user_id`, `nome`, `papel`, `qtd_itens`, `economia`, `perda`, `saldo`
- Linha por item (para drill-down): `payment_id`, `item_id`, `obs_id`, `valor_regra`, `valor_pago_final`, `delta`, `autor`, `papel`, `data_intervencao`, `data_acatamento`

Sem nova tabela — tudo deriva de `payment_observations` + `payment_items` + `user_roles`. Sem trigger, sem snapshot novo (já há `ai_analysis_versions` se precisarmos histórico mais profundo no futuro).

## Frontend
1. **Novo card KPI** em:
   - `src/pages/Kpis.tsx` (painel geral)
   - `src/pages/ExecutiveDashboard.tsx` (diretor)
   - `src/pages/AnalystProductivity.tsx` (supervisor já olha aqui)
   
   Card mostra: **Saldo líquido (R$)** com setinha verde/vermelha, sublegenda "X itens ajustados após intervenção", delta % vs janela anterior (reusa `deltaPct` de `kpiMetrics.ts`).

2. **Nova página `/relatorios/ajustes-intervencao`** (`src/pages/InterventionAdjustments.tsx`):
   - Filtros: período, hospital, papel (diretor/supervisor/ambos), usuário.
   - 3 KPIs no topo: Economia | Perda | Saldo líquido.
   - Tabela 1 — por usuário (ordenável por saldo).
   - Tabela 2 — drill-down item-a-item com link para `/pagamentos/:id` e destaque do item.
   - Export CSV.
   - Rota registrada em `src/config/navItems.ts` sob "Relatórios", visível só para roles diretor/supervisor/admin.

3. **Lib pura** `src/lib/interventionSavings.ts` com tipos e helper de formatação — testável isoladamente (`__tests__/interventionSavings.test.ts`).

## Pontos abertos a confirmar antes de codar
1. **Devolução de lote inteiro** (sem `item_id` nem `company_group_id` — observação a nível de lote): atribuímos o ajuste a **todos** os itens que foram acatados depois? Sugiro **sim, mas só os que tinham `validation_findings` não-vazio** no momento, para não contar ajustes alheios à intervenção.
2. **Múltiplas intervenções no mesmo item**: contamos o delta uma vez (último estado), atribuído ao **autor da observação mais recente antes do acatamento**. OK?
3. **Janela temporal padrão** do KPI: 30 dias (alinhado com `/kpis`). OK?

Respondidas essas 3, implemento migration + página + KPIs + testes em uma leva.
