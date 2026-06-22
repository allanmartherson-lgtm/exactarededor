# Plano: Tipo de Pagamento + Saneamento de Base

## 1. Cadastro de Tipos de Pagamento (admin)

Estender `payment_types` com metadados que governam parser, motor e UI:

- `tuss_default` (text, nullable) — TUSS aplicado quando a planilha não traz
- `requires_tuss_in_sheet` (bool, default true) — se false, wizard pula etapa
- `default_function` (text, nullable) — função aplicada às linhas
- `default_value_column_hint` (text) — palpite de cabeçalho de valor ("Valor a repassar", "Repasse"…)
- `expected_headers` (jsonb) — array de cabeçalhos esperados, usado para auto-mapear
- `allow_mixed_subtypes` (bool) — se true, base pode conter subtipos (ex: Parecer + Visita) e regra de subdivisão se aplica
- `subtype_split_hint` (jsonb) — `{ column, patterns: [{match, target_payment_type_id}] }`
- `active`, `display_order`, `description`

Nova tela `/cadastros/tipos-pagamento`: CRUD simples (DataTable + FormDialog), restrito a admin/diretor.

Seed inicial: Parecer Adulto, Visita, Cirurgia, SADT, Consulta, Exames Cardiologia — pré-preenchidos para Rede D'Or.

## 2. Motor de regras: `payment_type_id` opcional em `rules`

- Coluna `payment_type_id uuid null references payment_types(id)`
- Index parcial.
- `loadScopedRules` / matcher: quando a base tem `payment_type_id`, motor prefere regras com mesmo `payment_type_id`; só cai em regras com `payment_type_id IS NULL` se não houver match específico.
- Regras existentes continuam funcionando (NULL = qualquer tipo).
- Form de regra ganha select "Tipo de Pagamento (opcional)" — resolve Parecer × Visita com mesmo TUSS.

## 3. Modal de tipo após Análise/Confecção

Após o `PaymentModeSelectModal`, abrir `PaymentTypeSelectModal`:
- Lista `payment_types` ativos
- Busca + agrupamento por categoria
- Seleção persistida em `sessionStorage` e como query param `tipo=<id>`
- `NewPayment` lê e salva em `payments.payment_type_id` (coluna já existe ou criar)

Botão voltar para trocar modo. Tipo escolhido aparece como chip no topo do wizard.

## 4. Wizard de import sensível ao tipo

`parsePaymentFile` / mapeamento de colunas:
- Recebe o tipo escolhido
- Se `requires_tuss_in_sheet=false`: oculta etapa TUSS e injeta `tuss_default` por linha (com banner: *"TUSS X aplicado às N linhas conforme tipo Y"*)
- Auto-mapeia colunas usando `expected_headers`
- Se `default_function` setado e coluna função ausente, injeta valor

## 5. Detecção de linhas-total/rodapé (sempre perguntar)

Heurística no parser:
- Linha com chave operacional vazia (atendimento) + algum valor monetário OU
- Texto regex `/total|valor para emiss[aã]o|subtotal|nota fiscal/i` em qualquer célula OU
- Linhas finais com ≤2 células preenchidas e número grande na última

Resultado: painel "Linhas suspeitas detectadas" antes do commit, listando:
- Nº da linha original na planilha
- Conteúdo
- Motivo da suspeita
- Ação por linha: [Descartar] [Manter como item] [Tratar como total informativo]

Bloqueia avanço até decisão. Decisões ficam em `import_log` para auditoria.

## 6. Mistura de subtipos (Parecer + Visita)

Quando `allow_mixed_subtypes=true` no tipo escolhido:
- Parser aplica `subtype_split_hint` por linha (ex: célula "Médico Solic." contém "Visita" → vira `payment_type_id` de Visita)
- Preview mostra resumo: *"189 linhas → 187 Parecer + 2 Visita"*
- Cada item salvo com seu próprio `payment_type_id` real
- Motor avalia regra correta por item

## Detalhes técnicos

### Migrações
```text
1) ALTER TABLE payment_types
   ADD COLUMN tuss_default text,
   ADD COLUMN requires_tuss_in_sheet boolean DEFAULT true,
   ADD COLUMN default_function text,
   ADD COLUMN default_value_column_hint text,
   ADD COLUMN expected_headers jsonb DEFAULT '[]'::jsonb,
   ADD COLUMN allow_mixed_subtypes boolean DEFAULT false,
   ADD COLUMN subtype_split_hint jsonb,
   ADD COLUMN display_order int DEFAULT 0;

2) ALTER TABLE rules
   ADD COLUMN payment_type_id uuid REFERENCES payment_types(id) ON DELETE SET NULL;
   CREATE INDEX rules_payment_type_idx ON rules(payment_type_id) WHERE payment_type_id IS NOT NULL;

3) ALTER TABLE payments
   ADD COLUMN payment_type_id uuid REFERENCES payment_types(id);  -- se ainda não existir

4) ALTER TABLE payment_items
   ADD COLUMN payment_type_id uuid REFERENCES payment_types(id);  -- para mistura subtipo

5) Seed dos tipos Rede D'Or
```

### Arquivos novos
- `src/pages/PaymentTypesAdmin.tsx` — CRUD da tela
- `src/components/PaymentTypeSelectModal.tsx` — modal após modo
- `src/components/payment-wizard/SuspiciousRowsReview.tsx` — painel de linhas suspeitas
- `src/lib/detectSuspiciousRows.ts` — heurística + testes

### Arquivos editados
- `src/components/PaymentModeSelectModal.tsx` — após escolha, abre tipo modal
- `src/pages/NewPayment.tsx` — lê `tipo` query param, repassa ao parser
- `src/lib/parsePaymentFile.ts` — recebe `paymentType`, injeta TUSS/função, detecta suspeitas
- `src/pages/ValidationRules.tsx` (form de regra) — select de tipo
- motor de regras (`loadScopedRules` + matcher) — filtro por tipo
- nav (`src/config/navItems.ts`) — entrada "Tipos de Pagamento" no hub de Cadastros

### Ordem de entrega sugerida (entregar incrementalmente)
1. ✅ Migrações + seed + tela admin de tipos
2. ✅ Campo na rules + select no form de regra
3. ✅ Modal de seleção pós-modo + persistência no payment
4. ✅ Parser sensível ao tipo (TUSS default, função default)
5. ✅ Detecção de linhas suspeitas com painel de revisão
6. ⏳ Subtipos mistos

Cada passo é shippable sozinho — recomendo aprovar e ir por etapas para validar com base real entre cada uma.
