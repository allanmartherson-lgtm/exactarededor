---
name: Pool é soberano (itens sem dono + tela unificada)
description: Pool tem itens coletivos sem PJ; tela única com cards por PJ participante; rateio financeiro vem do pool calc
type: feature
---
Em pagamento de pool (`payments.pool_id IS NOT NULL`), o item **não pertence** a uma PJ. Modelo:

- `payment_items.is_pool_item = true`, `company_id` pode ser NULL.
- Trigger `enforce_pool_item_consistency` aplica isso no INSERT/UPDATE: pool → marca `is_pool_item=true`; não-pool → exige `company_id`.
- `distribute_unmatched_items_by_doctor` em pool insere itens com `company_id=NULL` e `is_pool_item=true` (não tenta hashear médico em PJ). Em lote comum o caminho original continua: cruza `doctor_companies × participants`.
- Rateio financeiro: vem 100% de `payment_company_financials` (uma linha por PJ participante), calculado pelo motor de pool. Soma de itens NÃO equivale a soma de uma PJ — o líquido por PJ depende do método do pool (igualitário / por participação / por especialidade).

UI:
- Rota dedicada `/pagamentos/:id/pool` renderiza `PoolAnalysis.tsx`.
- `CompanyAnalysis` redireciona pra `/pool` quando `pool_id` está preenchido. Acessar `/empresa/:groupId` num lote de pool é sempre erro de roteamento (não duplica lógica).
- Layout pool-mode: header + N cards (1 por PJ participante: Bruto/Descontos/Líquido/Participação) + `PoolCalculationCard` + `UnmatchedItemsPanel` + `ItemsDataGrid` único (sem filtro/coluna empresa).
- Botão da quarentena em pool: "Promover ao pool / Distribuir" (em vez de "Distribuir entre PJs").

Memória relacionada: `features/pool-soberano.md` (regra base) foi expandida aqui. Não criar exceção pontual em PaymentDetail/CompanyAnalysis para pool — sempre delegar para `PoolAnalysis`.
