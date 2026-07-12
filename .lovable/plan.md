## Contexto

A tela `/financeiro/creditos-debitos` (`src/pages/CreditosDebitos.tsx`) já está grande e vem ganhando ajustes pontuais. Vamos consolidar 3 frentes em um único ciclo, testar tudo junto e reduzir o vai-e-vem.

## Escopo desta rodada

### 1) Legibilidade da aba ativa (claro + escuro)
- Aba selecionada hoje usa cor cheia que contrasta mal no chip de contagem.
- Ajuste em `CreditosDebitos.tsx`: aplicar `data-[state=active]:bg-primary data-[state=active]:text-primary-foreground` e, no badge interno, `bg-primary-foreground/20 text-primary-foreground` para o estado ativo. Estado inativo mantém `text-muted-foreground` com badge `bg-muted`.
- QA visual nos dois temas (Playwright screenshot em `?theme=light` e `?theme=dark`).

### 2) Aplicar em massa no lote vigente ("Em andamento")
Nova ação na aba **Em andamento** (débitos já confirmados, aguardando lote):

- Barra de ações do grupo (PJ) ganha botão **"Aplicar no lote vigente"** — usa o lote em `revisao_pj`/`revisao_analista` mais recente da PJ (mesma lógica já usada em `ensureLoteLiquido`).
- Barra global no cabeçalho: **"Aplicar todos no lote vigente"** com preview (quantas PJs, quantos débitos, quanto cabe no líquido de cada PJ).
- Fluxo: seta `target_payment_id` no `glosa_debts` + invoca `apply-company-deductions` por `(payment_id, company_id)` em paralelo. Reaproveita `confirmGlobalMass` já existente — só precisamos do seletor automático de lote vigente por PJ.
- Respeita gate: se o lote estiver em status final (`pago`/`arquivado`), pula com aviso.

### 3) Relatórios (PDF + Excel)
Botão **"Exportar"** no header da tela, com dropdown: **PDF** e **Excel**.

Escopo do relatório (respeitando filtros ativos: período, PJ, CC, trilha):

**Aba "Aplicado no mês" / "Histórico aplicado"**
- Uma linha por aplicação (`glosa_payment_applications`): PJ, CNPJ, Médico, Lote (nº + competência), Status do lote, Data aplicação, Aplicado por, Valor aplicado, Origem (glosa/ajuste manual), Motivo, Parcela X/Y.

**Aba "Em andamento" (débitos confirmados aguardando lote)**
- PJ, CNPJ, Médico, Total do débito, Já aplicado, Saldo em aberto, Parcelas planejadas, Lote-alvo (se houver) + status, Data de confirmação, Confirmado por.

**Aba "A confirmar"**
- PJ, Médico, Valor proposto, Origem (lote/conciliação retro), Data de proposta.

**KPIs no topo do relatório**: A confirmar, Em andamento, Aplicado no período, Sem lote-alvo.

**Formato**
- **Excel** (`xlsx` via biblioteca já em uso `xlsx` ou nova `exceljs`): 1 aba por seção + aba "Resumo" com KPIs. Colunas com formato BR (moeda, data). Cabeçalho colorido.
- **PDF** (via `jspdf` + `jspdf-autotable` — já usados no projeto): capa com hospital, período, filtros aplicados, KPIs; tabelas paginadas por seção; rodapé com data de emissão + usuário.

**Arquitetura**
- Novo arquivo `src/lib/creditosDebitosReport.ts`: função pura `buildReportData(filters)` → estrutura tipada.
- `src/lib/exports/creditosDebitosExcel.ts` e `creditosDebitosPdf.ts`: consomem a estrutura e geram o arquivo.
- Botão em `CreditosDebitos.tsx` chama `buildReportData` (usando os hooks/dados já carregados; sem refazer as queries).

## Fora de escopo (evita novo ciclo curto)

- Nada de novos filtros aqui — se surgir demanda, entra em ciclo próprio.
- Não vamos mexer no motor `apply-company-deductions` (só invocar).
- Não vamos criar novas tabelas.

## Ordem de execução

1. Fix visual das abas (5 min, baixo risco).
2. Botão "Aplicar no lote vigente" (individual + massa).
3. Módulo de relatórios (Excel primeiro, depois PDF).
4. QA integrado com Playwright: screenshot claro+escuro, download dos 2 arquivos, checagem de conteúdo.

## Riscos / decisões pendentes

- **"Lote vigente"**: definimos como o lote mais recente da PJ com status ∈ {`revisao_pj`, `revisao_analista`, `em_confeccao`}. Se você preferir outra regra (ex.: só o lote atualmente selecionado no seletor global de competência), me diga antes.
- **Excel**: usar `xlsx` (SheetJS) — mais leve — ou `exceljs` — mais formatação nativa? Vou de **exceljs** por permitir cores/formato de moeda direto, salvo objeção sua.
- **PDF**: `jspdf + autotable` para consistência com relatórios existentes.

Confirma que posso seguir com tudo assim?
