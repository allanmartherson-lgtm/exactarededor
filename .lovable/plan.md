## Objetivo

Preparar o sistema para lotes grandes (150+ empresas, milhares de itens) sem timeout, e dar visibilidade aos itens cujas empresas ainda não estão cadastradas.

---

## Parte 1 — Processar por empresa em background (sem timeout)

Hoje a `analyze-payment` recebe o `payment_id` inteiro e tenta processar todos os itens em uma única execução de até 150s. Em lotes grandes isso estoura.

**Nova arquitetura (dispatcher → workers):**

1. Criar `dispatch-payment-analysis` (edge function leve):
   - Recebe `payment_id`.
   - Lê todas as `company_name` distintas do lote (`payment_items`).
   - Cria/atualiza um registro em `payment_processing_jobs` com `total_companies`, `processed_companies = 0`, `status = 'em_andamento'`.
   - Dispara, em paralelo (chunks de ~10 invocações simultâneas), uma chamada `analyze-payment` para cada empresa via `supabase.functions.invoke("analyze-payment", { body: { payment_id, company_name } })` em modo fire-and-forget (sem `await` no retorno).
   - Retorna 202 imediatamente com `total_companies` para o cliente acompanhar.

2. Ajustar `analyze-payment` (sem reescrever — já suporta `company_name`):
   - Ao final, incrementar `processed_companies` em `payment_processing_jobs` de forma atômica (RPC `increment_processed_company`).
   - Quando `processed_companies = total_companies`, marcar `status = 'concluido'` e disparar `notify-analyst-event`.
   - Capturar erros por empresa em coluna `failed_companies jsonb[]` para reprocesso pontual.

3. Tabela nova `payment_processing_jobs`:
   - `payment_id`, `total_companies`, `processed_companies`, `status` (em_andamento, concluido, parcial), `failed_companies jsonb`, `started_at`, `finished_at`.
   - RLS: workflow lê/escreve.

4. Frontend (`PaymentDetail.tsx`):
   - Mostrar barra de progresso "Analisando 47/152 empresas…" usando realtime na tabela `payment_processing_jobs`.
   - Botão "Reprocessar empresas com falha" quando `failed_companies` não vazio.

**Ganhos:** cada worker processa apenas ~30 itens em média (lote/empresa), terminando em poucos segundos. Sem risco de timeout. Paralelismo controlado evita estourar conexões.

---

## Parte 2 — Relatório de empresas não cadastradas

Os itens já entram no lote com `company_id = NULL` quando a empresa não é reconhecida. Falta visibilidade.

1. **No upload (`NewPayment.tsx`):**
   - Antes de submeter, mostrar um painel "Empresas não cadastradas" listando os `rawCompanyName` sem match (ou match < 90% não confirmado), com contagem de itens e valor bruto total por empresa.
   - Botão "Baixar CSV" com colunas: empresa_arquivo, qtd_itens, valor_bruto_total, primeiro_medico, arquivo_origem.
   - Toast de aviso ao confirmar: "X itens entrarão sem empresa cadastrada — relatório disponível na tela do lote."

2. **Na tela do lote (`PaymentDetail.tsx`):**
   - Nova seção "Empresas não reconhecidas" (sempre visível quando há itens com `company_id IS NULL`).
   - Lista cada `company_name` distinta sem `company_id`, com:
     - quantidade de itens, valor bruto total
     - botão "Vincular a empresa existente" (abre `CompanyCombobox` e atualiza todos os itens daquela empresa em uma chamada)
     - botão "Cadastrar nova empresa" (abre dialog de criação de `companies`, já preenchido com o nome)
     - botão "Baixar CSV"
   - Após vincular/cadastrar, oferece reprocessar somente aquela empresa (usa o dispatcher da Parte 1 com filtro).

3. Não excluir itens — eles continuam no lote como hoje, apenas ganham essa camada de gestão.

---

## Arquivos afetados

**Backend:**
- `supabase/functions/dispatch-payment-analysis/index.ts` (novo)
- `supabase/functions/analyze-payment/index.ts` (incremento de progresso ao final)
- migração: tabela `payment_processing_jobs` + RPC `increment_processed_company` + realtime publication

**Frontend:**
- `src/pages/NewPayment.tsx` (painel de empresas não reconhecidas + CSV no upload)
- `src/pages/PaymentDetail.tsx` (barra de progresso + seção empresas não reconhecidas)
- `src/components/payment-detail/UnregisteredCompaniesPanel.tsx` (novo)
- `src/components/payment-detail/AnalysisProgressBar.tsx` (novo)
- Substituir chamadas atuais de `supabase.functions.invoke("analyze-payment", { body: { payment_id }})` por `dispatch-payment-analysis` quando o lote tiver mais de 1 empresa.

---

## Não incluído (para confirmar depois)

- Retry automático de empresas falhas (faremos manual via botão na primeira versão).
- Limitar concorrência por instância (10 paralelos por chunk já é seguro para a maioria dos casos; ajustável via constante).
