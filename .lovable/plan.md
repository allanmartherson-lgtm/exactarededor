# Mínimo Garantido — Plano de implementação

## Conceito
Cláusula de **piso** aplicada **após** o cálculo normal da regra. Não é um novo `calculation_type` — é um *modificador pós-cálculo* que convive com qualquer método (percentual_convenio, valor_fixo, tabela_diferenciada, pacote, bonus).

```
producao_competencia = SOMA(gross_amount) de todos payment_items
                       do (medico + PJ) na mesma competência
piso                  = rules.minimo_garantido_valor
complemento           = max(0, piso − producao_competencia)
total_pago            = max(producao_competencia, piso)
```

Decisões já confirmadas:
- **Janela:** competência (mês). Soma todas as folhas do mesmo `competence_month`.
- **Escopo:** médico + PJ específica (cada vínculo `doctor_companies` tem seu próprio piso).
- **Base:** bruto (produção calculada pelo motor, antes de glosas/descontos).

## Modelo de dados

### Migration 1 — campos em `rules`
```sql
ALTER TABLE public.rules
  ADD COLUMN minimo_garantido_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN minimo_garantido_valor numeric,
  ADD COLUMN minimo_garantido_escopo text DEFAULT 'medico_empresa'
    CHECK (minimo_garantido_escopo IN ('medico_empresa')),
  ADD COLUMN minimo_garantido_periodicidade text DEFAULT 'competencia'
    CHECK (minimo_garantido_periodicidade IN ('competencia')),
  ADD COLUMN minimo_garantido_base text DEFAULT 'bruto'
    CHECK (minimo_garantido_base IN ('bruto'));
```
Campos `escopo/periodicidade/base` ficam parametrizáveis (CHECK aceita só 1 valor agora; abre caminho pra "líquido" e "anual" depois sem nova migration).

### Migration 2 — tabela de aplicações (idempotência + auditoria)
```sql
CREATE TABLE public.minimum_guarantee_applications (
  id uuid PK default gen_random_uuid(),
  rule_id uuid → rules,
  doctor_id uuid → doctors,
  company_id uuid → companies,
  competence_month text,           -- 'YYYY-MM'
  hospital_id uuid → hospitals,
  producao_calculada numeric,      -- soma bruto antes do piso
  piso_aplicado numeric,
  complemento_valor numeric,       -- 0 se produção ≥ piso
  payment_id uuid → payments,      -- folha onde o complemento foi lançado
  synthetic_item_id uuid,          -- payment_item criado p/ o complemento
  status text ('aplicado'|'revertido'),
  applied_at, applied_by, reverted_at, reverted_by,
  UNIQUE (rule_id, doctor_id, company_id, competence_month, status)
    WHERE status = 'aplicado'
);
```
A UNIQUE parcial garante: **um único complemento aplicado por (médico, PJ, competência, regra)**. Reaplicar exige reverter o anterior.

### Migration 3 — flag no item sintético
Em `payment_items`, novo valor pro enum/text que distingue tipo:
```sql
ALTER TABLE payment_items
  ADD COLUMN item_origin text DEFAULT 'producao'
    CHECK (item_origin IN ('producao','complemento_minimo','bonus','ajuste'));
```
Item sintético do complemento:
- `item_origin='complemento_minimo'`
- `procedure_name='Complemento Mínimo Garantido — <regra>'`
- `gross_amount = complemento_valor`, `expected_amount = complemento_valor`
- `applied_calc_method = NULL`, ligado à `rule_id` do piso

## Motor — novo pass

Edge function nova: `apply-minimum-guarantee` (Pass 3, roda **depois** de `compute-company-financials` e antes de fechar status para validação).

Algoritmo:
1. Carrega `payment` → `competence_month`.
2. Lista regras ativas com `minimo_garantido_ativo=true` cujo escopo (médico/PJ) tem itens neste pagamento.
3. Para cada (regra, médico, PJ):
   a. Soma `gross_amount` dos `payment_items` **dessa competência** em **todos os payments** com o mesmo `(doctor_id, company_id, competence_month)` — filtra `item_origin='producao'` (não conta complemento anterior).
   b. Lê `minimum_guarantee_applications` existente pra mesma chave.
   c. Se `producao ≥ piso`: nada a fazer. Se já existia complemento aplicado, **reverter** (deletar item sintético + marcar `status='revertido'`).
   d. Se `producao < piso`: criar item sintético no **payment atual** (último da competência) e registrar aplicação.
4. Re-disparar `compute-company-financials` no payment que recebeu o complemento.

**Idempotência**: rodar 2x dá o mesmo estado (compara aplicação existente, atualiza só se valor mudou).

**Quando dispara**: ao final do `analyze-payment` (se a regra do médico tem piso), e manualmente via botão "Recalcular mínimos" no detalhe do payment.

## UI

### Cadastro de regra (`ValidationRules.tsx` / `RuleEditor`)
Nova seção colapsável **"Mínimo garantido"** com:
- Switch "Aplicar piso de produção"
- Input R$ "Valor mínimo mensal"
- Read-only por enquanto: "Avaliado por competência, sobre produção bruta, por médico+PJ"
- Helper text explicando o cálculo

### Detalhe do pagamento (`CompanyAnalysis.tsx`)
- Card novo "Complemento de mínimo garantido" quando houver `minimum_guarantee_applications` no pagamento, mostrando:
  - Produção da competência (bruta)
  - Piso configurado
  - Complemento aplicado (ou "Produção acima do piso ✓")
  - Link pra outras folhas da mesma competência consideradas
- Item sintético aparece na grid de itens com badge "Complemento mínimo" e ação "ver memorial de cálculo"

### Botão de recálculo
Em `PaymentConciliationModal` ou no header do payment: "Reaplicar mínimos garantidos" (admin).

## Casos de borda tratados

| Caso | Comportamento |
|---|---|
| 2 folhas no mesmo mês (ex.: produção + retroativa) | Soma as duas; complemento entra na **última** processada |
| Produção sobe após complemento já lançado (correção) | Pass detecta `producao ≥ piso`, reverte item sintético, marca `revertido` |
| Médico sem PJ vinculada | Regra não aplica (core: médico precisa de PJ pra receber) |
| Pagamento já aprovado | Pass não toca; complementos retroativos viram **retroactive_reconciliation** (fluxo existente) |
| Regra com `valid_from/until` | Respeita vigência por competência |
| Múltiplas regras com piso pro mesmo médico | Erro de validação no save da regra (UNIQUE lógica via `validate-rule-save`) |

## Ordem de execução

1. **Migrations** (3 acima) — uma única chamada
2. **Edge function** `apply-minimum-guarantee` + tests deno
3. Hook no `analyze-payment` pra chamar o pass 3 ao final
4. UI cadastro de regra (formulário + validação)
5. UI detalhe do payment (card + badge no item)
6. Botão "Reaplicar mínimos" + audit_log
7. Smoke: criar regra com piso de R$ 20k, importar folha com produção de R$ 12k → ver complemento de R$ 8k

## Fora do escopo desta entrega
- Periodicidade anual / por pagamento (estrutura aceita, mas não implementada)
- Base líquida (após glosa)
- Piso por médico agregando todas as PJs
- Bônus de superação (médico recebe piso + % do excesso) — outro tipo de regra

Confirma que sigo nessa ordem?
