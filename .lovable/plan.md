# Plano — Pagamento Manual com Ficha de Composição

Objetivo: permitir lançar pagamentos cuja origem é uma planilha externa (nefrologia, UTI, plantão fechado, coordenação rateada, etc.) sem modelar as fórmulas no motor. O analista informa o valor final por médico/empresa, anexa a fonte e opcionalmente descreve a composição em rubricas. O resto do fluxo (glosa, NF, conciliação, aprovação, auditoria) continua igual.

## 1. Conceito

- Novo modo de análise no lote: `analysis_mode = 'manual'`.
- Itens criados nesse modo já chegam com `gross_amount` definido pelo analista — o motor **pula regras de cálculo** e marca `applied_calc_method = 'manual_entry'`.
- Cada item carrega: tipo de serviço, médico (opcional), empresa, especialidade (opcional), atendimento (opcional), paciente (opcional), competência, valor, anexo-fonte e composição estruturada (JSON livre de rubricas).
- Glosa, vínculo médico→PJ, NF, conciliação e aprovação rodam exatamente como nos lotes normais.

## 2. Mudanças no banco

Migração única adicionando:

- `payments.analysis_mode` aceita novo valor `'manual'` (sem CHECK rígido — já é text).
- `payment_items`:
  - `is_manual_entry boolean default false`
  - `manual_composition jsonb` — array `[{rubrica, qtd, unit, total, obs}]`
  - `manual_source_attachment_path text` — caminho no bucket
  - `manual_entered_by uuid` / `manual_entered_at timestamptz`
- `payment_types.calc_strategy` ganha valor `'manual'` para marcar tipos que sempre entram como manual (ex: "Nefrologia — Composição", "Plantão Fechado", "Coordenação").
- Novo bucket privado `payment-manual-sources` para os PDFs/XLSX de origem, com RLS por hospital_id do pagamento.

Auditoria: trigger já existente em payment_items registra mudança; adicionar log explícito em `audit_log` quando `is_manual_entry = true` no insert.

## 3. Motor de cálculo

- `dispatchAnalysis` / pipeline de regras: se `payment.analysis_mode = 'manual'` **ou** item com `is_manual_entry = true`, pular busca de regra, manter `gross_amount` informado, setar `applied_calc_method = 'manual_entry'`, `expected_amount = gross_amount`, `ai_status = 'sem_intervencao'`.
- Glosa, recompute de status do pagamento, vínculo médico→PJ e cruzamento NF continuam ativos.
- Conciliação contra base hospitalar: itens manuais não tentam matching por TUSS — vão para uma seção própria "Lançamentos manuais" no modal, conferidos só por presença/valor.

## 4. UI

### 4.1. Criação do lote
No wizard de novo pagamento, terceira opção ao lado de "Importar planilha" e "Em confecção": **"Lançamento manual"**. Define `analysis_mode = 'manual'` e abre direto a tela de edição de itens manuais (sem upload).

### 4.2. Tela de lançamento manual (`/pagamentos/:id` quando manual)
- Tabela editável de itens, uma linha por médico/empresa.
- Colunas: empresa (combobox), médico (combobox, opcional), tipo de serviço (combobox de payment_types), especialidade (opcional), competência, valor total (R$).
- Botão "Anexar fonte" por linha → upload no bucket, fica vinculado ao item.
- Botão "Composição" abre dialog com tabela de rubricas (rubrica/qtd/unit/total/obs). Soma das rubricas precisa bater com o valor total — aviso visual se divergir, não bloqueia.
- Botão "Adicionar linha", "Duplicar linha", "Excluir".
- Validação mínima: empresa + tipo + valor > 0.

### 4.3. Detalhe do item
- No `PaymentDetail`, itens manuais ganham badge "Manual" e seção "Composição" mostrando a tabela de rubricas + link para baixar o anexo-fonte.
- PDF de validação do lote inclui a composição quando presente.

## 5. Aprovação e fluxo posterior

- Mesma esteira: análise → validação → aprovação por diretor.
- Diretor vê no card: "Lote manual — N itens, R$ X total" + acesso aos anexos-fonte.
- Após aprovar: gera NF, concilia, paga — sem mudança.

## 6. O que NÃO entra agora

- Fórmulas paramétricas (horas × valor hora, sessões CRRT × valor sessão). A composição é só descritiva.
- Promoção automática de composições recorrentes em tipos calculados. Fica como passo futuro quando algum padrão se provar estável entre hospitais.
- Importação de XLSX externo para popular composição. Por ora é digitação manual + anexo da planilha original como prova.

## 7. Ordem de execução

1. Migration (schema + bucket + RLS).
2. Tipos de pagamento seed: marcar/criar alguns com `calc_strategy = 'manual'` (Nefrologia Composição, Plantão Fechado, Coordenação Rateada).
3. Backend: ajuste no pipeline de regras para pular itens manuais.
4. UI wizard: nova opção "Lançamento manual".
5. UI tela de lançamento (tabela editável + dialog de composição + upload).
6. UI detalhe: badge + seção composição + anexo no PDF.
7. Conciliação: seção "Lançamentos manuais" no modal.
8. Testes: contrato garantindo que item manual não roda motor e preserva valor.

## Detalhes técnicos (referência)

- `payment_items.manual_composition` formato: `[{"rubrica":"Horas CRRT","qtd":130.35,"unit":120,"total":15643,"obs":""}, {"rubrica":"Coordenação","total":3000}, {"rubrica":"Pareceres","qtd":31,"unit":400,"total":12400}]`.
- Bucket `payment-manual-sources`, paths `{hospital_id}/{payment_id}/{item_id}/{filename}`. RLS via `has_hospital_access(auth.uid(), hospital_id)`.
- Hook novo `useManualPaymentItems(paymentId)` para CRUD da tabela.
- Skip do motor: em `dispatchAnalysis.ts`, primeira checagem `if (item.is_manual_entry) return { method: 'manual_entry', expected: item.gross_amount, status: 'sem_intervencao' }`.
