## Objetivo

Tratar o modo **manual** como um fluxo de primeira classe, com layout, colunas e relatório próprios — sem reaproveitar o que veio de análise/confecção (que pressupõem regra, TUSS, paciente, divergências).

## Descobertas relevantes do código

- `payment_items` já tem o campo `manual_note` (livre) e `specialty` (livre) — não precisa de migration para observação nem especialidade por linha.
- `manual_source_attachment_path` já guarda o anexo por linha; o lançamento manual (`ManualPaymentEntry.tsx`) já faz upload, só falta exibir depois.
- Não existe ainda anexo geral do lote no modo manual — vamos adicionar `payments.manual_general_attachment_path` (nullable) via migration.
- `payment_items.is_manual_entry = true` é a flag autoritativa.
- A tela do print é `CompanyAnalysis.tsx` (3.3k linhas) e reusa `ItemsDataGrid` (focado em regras/divergências). Para o manual vamos renderizar um grid próprio e esconder as áreas que não fazem sentido — sem refatorar o resto.

## Mudanças

### 1. Migration (anexo geral do lote manual)
```text
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS manual_general_attachment_path text,
  ADD COLUMN IF NOT EXISTS manual_general_attachment_name text;
```
Sem alteração de RLS (políticas existentes já cobrem).

### 2. `ManualPaymentEntry.tsx` (mesa de lançamento)
- Adicionar **campo Observação** (textarea curta) por linha — persiste em `manual_note`.
- Carregar/salvar `manual_note` no `loaded`/`buildPayload`.
- Bloco de **anexo geral** no topo (acima da tabela): upload único do lote → grava em `payments.manual_general_attachment_path/_name`. Bucket `payment-manual-sources`, mesma chave `${hospital}/${id}/_general/`. Texto: "Anexo do lote (opcional) — planilha-fonte que cobre o pagamento inteiro."
- Manter o anexo por linha como opcional (já existe).

### 3. `CompanyAnalysis.tsx` — modo manual (condicional `isManual = analysis_mode === 'manual'`)
Quando `isManual`:
- **Cabeçalho**: esconder cards "Alertas" e "Críticos" (não existem alertas de regra no manual). Manter Itens, Valor Líquido.
- **Faixa de deduções/composição**: manter (débitos/glosas/pool podem existir).
- **Abas**: mostrar só `Itens` e `Histórico` — esconder `Divergências`, `Detalhe IA`.
- **Filtros do grid** (`Todos status`, `Sem regra`, `Alertas assistenciais`, `Colunas`): esconder no manual.
- **Grid de itens**: renderizar componente novo `ManualItemsGrid` em vez de `ItemsDataGrid`. Colunas:
  | Médico | Empresa | Especialidade | Valor | Observação | Anexo |
  - Anexo: ícone clipe + nome com link `getPublicUrl`/`createSignedUrl` do bucket `payment-manual-sources`.
  - Se não tiver anexo por linha, mostra "—" (e o usuário sabe que tem o geral no header).
  - Totalizador no rodapé: soma dos `gross_amount`.
- **Banner do header do grupo**: mostrar link do anexo geral do lote (se houver).

### 4. Botão/link "Adicionar item manual"
Já existe. No modo manual, manter — leva para `ManualPaymentEntry`.

### 5. Relatório de validação (PDF)
- `groupValidationPdf.ts` — detectar `analysis_mode === 'manual'` e gerar **versão enxuta**:
  - Cabeçalho do lote + empresa + tipo "Lançamento manual"
  - Tabela: Médico · Especialidade · Observação · Valor · Anexo (nome do arquivo)
  - Totais + assinatura
  - Remover seções: "Sem regra", divergências de cálculo, comparativo esperado vs pago, alertas assistenciais.

### 6. Memória de projeto
Adicionar `mem://features/manual-mode-ui` registrando: campos próprios, sem regra/divergência, anexo dual (geral + linha), `manual_note` é a observação.

## Fora de escopo desta rodada
- Repensar fluxo de aprovação/validação do manual (continua o mesmo: encaminhar para validação → diretor).
- Anexar múltiplos arquivos por linha (mantém 1).
- Conciliação NF×pedido específica do manual.

## Arquivos tocados
- `supabase/migrations/...` (1 migration nova)
- `src/pages/ManualPaymentEntry.tsx`
- `src/pages/CompanyAnalysis.tsx`
- `src/components/payment-detail/ManualItemsGrid.tsx` (novo)
- `src/lib/groupValidationPdf.ts`
- `.lovable/memory/features/manual-mode-ui.md` (novo) + index

Quer que eu siga assim?
