# Pool de Produção entre Empresas — Arquitetura Genérica

## Casos cobertos

1. **Infectologistas (split com hospital):** Total 100% convênio − fixo da empresa → divide /2. Metade fica com o hospital (não paga), metade vai para a PJ. Resultado: 1 empresa recebe.
2. **Pool entre 2 PJs:** Total 100% convênio − plantão da empresa A → restante dividido entre PJ A e PJ B (não envolve hospital). Resultado: 2 empresas recebem.
3. **Extensível:** N participantes, percentuais arbitrários (60/40, 33/33/33), múltiplas deduções antes do rateio.

## Modelo de dados

### `pools` (novo)
Define um esquema de pool reutilizável.
- `id`, `nome` ("Infecto BSB — split hospital", "Pool A+B")
- `descricao`
- `base_calculo`: `soma_convenio_100` | `soma_expected` | `soma_bruto`
- `ativo`, `vigencia_inicio`, `vigencia_fim`
- audit (`created_by`, timestamps)

### `pool_deductions` (novo, ordenado)
Deduções aplicadas ao bolo ANTES do rateio.
- `pool_id`, `ordem`
- `tipo`: `fixo_mensal` | `plantao` | `ajuste_credito` | `ajuste_debito` | `glosa_parcelada` | `valor_referencia_externa`
- `valor` (quando fixo) **ou** `company_id` de origem (quando vem de ajuste cadastrado)
- `descricao` ("Fixo mensal hospital", "Plantão empresa A")
- `obrigatoria` (se faltar dado, bloqueia cálculo vs. apenas avisa)

### `pool_participants` (novo)
Quem recebe o rateio.
- `pool_id`
- `company_id` (FK companies) — **ou** `participant_type='hospital_nao_paga'` (sentinel, não gera linha de pagamento)
- `percentual` (soma deve = 100)
- `ordem_exibicao`

### `company_financial_adjustments` (novo — universal, não só pool)
Créditos/débitos avulsos por empresa, parcelados ou não.
- `company_id`, `tipo` (credito|debito|glosa_parcelada|acordo)
- `valor_total`, `parcelas_total`, `parcelas_pagas`
- `data_inicio`, `ativo`, `origem`, `descricao`
- `created_by`, audit

### `company_adjustment_applications` (novo)
Rastreia em qual `payment_id` cada parcela foi aplicada (idempotência).

### Vínculo regra ↔ pool
Em `rules`: novo `calculation_type = 'pool_empresa'` + campo `pool_id`. A regra é cadastrada no escopo `master` ou `especifica` (empresa "Infecto") apontando o pool a usar.

## Motor (engine) — 2 passos

**Pass 1 — por item (como hoje):** calcula `expected_amount` de cada `payment_item` a 100% convênio (ou base configurada). Persiste normalmente.

**Pass 2 — pool (novo, após Pass 1):**
1. Identifica `payment_company_groups` cujas empresas estão em `pool_participants` de pools ativos vigentes no período.
2. Agrupa itens pelo `pool_id` (não por company).
3. Calcula bolo = `Σ base_calculo` dos itens elegíveis.
4. Aplica `pool_deductions` na ordem (fixo + plantão da empresa A + ajustes ativos).
5. Distribui residual pelos `pool_participants` conforme percentuais.
6. Para cada participante real (≠ `hospital_nao_paga`):
   - Cria/atualiza um `payment_company_group` sintético com `total_amount = quota`.
   - Rateia a quota proporcionalmente nos `payment_items` originais (ou marca os itens como "agrupados em pool" e cria linha sintética — decidir conforme caso de uso de relatório).
7. Para o sentinel "hospital não paga": gera linha informativa, valor não entra em totais a pagar.

**Auditoria:** salva snapshot completo do cálculo do pool em nova tabela `pool_calculation_runs` (bolo, deduções aplicadas com referência, quotas finais) → vinculada ao `payment_id`.

## UI

### Nova seção "Pools" (sidebar, dentro de Cadastros ou Regras)
- Lista de pools, criar/editar
- Form: nome, base, deduções (drag-reorder), participantes (% com validação soma=100)
- Simulador: cola valores de teste → mostra bolo, deduções, quotas

### Empresas → aba "Financeiro" (já proposta)
- Lista de `company_financial_adjustments` (credito/debito/glosa parcelada)
- Botão "Criar crédito/débito"
- Histórico de aplicações (`company_adjustment_applications`)

### PaymentDetail → card "Cálculo do pool"
Quando o pagamento envolve pool, mostra:
```
Pool: Infecto BSB — split hospital
Base (100% convênio): R$ 115.332,19
(−) Fixo mensal hospital:  −45.000,00
(−) Crédito 12x (parc. 3): −3.730,89
Bolo líquido:              66.601,30
Rateio:
  Hospital (50%) — não paga: 33.300,65
  Infectologistas (50%):     33.300,65  ← linha de pagamento
```

### Regras → novo tipo
Ao escolher `calculation_type = pool_empresa`, mostra dropdown de pools existentes em vez dos campos de percentual normal.

## Fases de entrega

**Fase 1 (esta entrega):**
- a) Tabelas: `pools`, `pool_deductions`, `pool_participants`, `company_financial_adjustments`, `company_adjustment_applications`, `pool_calculation_runs`
- b) UI Pools (CRUD + simulador)
- c) UI Empresas → aba Financeiro (CRUD ajustes)
- d) Suporte ao tipo `pool_empresa` em regras (form + validação)

**Fase 2:**
- e) Engine: Pass 2 de cálculo de pool em `analyze-payment` + dispatch
- f) Card "Cálculo do pool" no PaymentDetail
- g) Aplicação automática de parcelas de ajustes ativos durante análise

**Fase 3:**
- h) Vínculo `glosa_debts` → gera `company_financial_adjustments` parceladas automaticamente
- i) Relatório de pools por competência

## Decisões pedidas antes de codar

1. **Linha sintética vs. rateio nos itens originais:** prefere que cada `payment_item` mantenha seu valor original e o pool ajuste apenas o `total_amount` do `payment_company_group` (mais simples, preserva histórico)? Ou rateio item-a-item (relatórios mais detalhados, mais complexo)?
2. **Hospital "não paga":** OK criar linha informativa zerada para auditoria, ou suprimir totalmente?
3. **Posso seguir com a Fase 1 (migration + UIs de cadastro), sem mexer no engine ainda?**
