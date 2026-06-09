
## Problema

Hoje, dentro da apuração retroativa, a aba **Planilha** chama `parseSpreadsheet()` que procura cegamente colunas chamadas `atendimento`, `tuss`, `data`, `paciente`, `funcao`, `valor`. Se a base hospitalar usar nomes diferentes (ex.: "Nr. Atendimento", "Cód. Procedimento", "Vlr Pago", "CRM Executor", "Empresa"), o parser devolve linhas vazias e **nenhuma UI aparece** — você vê só um toast genérico ou nada.

Você quer: subir o arquivo, **ver um wizard de mapeamento** (igual aos imports do sistema), confirmar quais colunas representam o quê, e aí o cruzamento roda dentro do escopo (médico/PJ/período) que você já definiu na apuração.

## O que vai mudar

### 1. Novo componente `RetroactiveMappingWizard`
Arquivo: `src/components/retroactive/RetroactiveMappingWizard.tsx`

Ao selecionar um arquivo (.xlsx/.csv) na aba "Planilha":
- Faz parse bruto da 1ª aba (sem tentar adivinhar) e mostra as **N colunas detectadas** com 3 linhas de preview.
- Para cada campo-alvo (Atendimento, TUSS, Data, Paciente, Função, Valor alegado, Médico, Empresa), um `<Select>` lista as colunas do arquivo. Sugere automaticamente por heurística (mesma lógica de `findCol`), mas analista pode trocar.
- Campos obrigatórios mínimos: **Atendimento + TUSS + Valor alegado**. Médico/Empresa são opcionais (só usados pra alertar quando linha vier fora do escopo da apuração).
- Mostra contador: "X linhas vão entrar / Y descartadas por falta de Atendimento ou TUSS".
- Botão "Confirmar mapeamento" preenche os drafts e fecha o wizard. Mantém o botão "Rodar cruzamento" inalterado.

### 2. Validação contra o escopo
Após mapear, antes de enviar pro edge function:
- Se a apuração tem `doctor_id` definido e a planilha trouxe nomes de médico diferentes → marca essas linhas com um aviso visual (badge "fora do escopo"), mas deixa o analista decidir incluir ou não.
- Mesma coisa pra empresa.
- Datas fora do `period_start/period_end ±90d` também ganham aviso.

### 3. Feedback de upload
Quando o parser não encontra **nenhuma linha** com dados úteis, mostra um modal explicando o motivo (ex.: "Não identificamos coluna de atendimento") em vez do toast atual que some.

### 4. Aproveitar parser canônico (opcional, segunda etapa)
Não vou tocar agora em `parsePaymentFile.ts`. Se depois você quiser uniformizar 100% com a conciliação do lote, a gente extrai um `ConciliationGrid` compartilhado — mas isso era a "Opção 1" do refactor completo. Aqui mantenho a tela atual e só conserto o ponto cego do upload.

## Arquivos tocados

- **Novo:** `src/components/retroactive/RetroactiveMappingWizard.tsx`
- **Editado:** `src/components/retroactive/RetroactiveReconciliationsTab.tsx`
  - Substitui o `<input type="file">` da aba "Planilha" por trigger que abre o wizard
  - `parseSpreadsheet()` vira `parseRawSheet()` (só lê + devolve linhas brutas + cabeçalhos)
  - Aplicação do mapeamento gera os `DraftItem[]` igual hoje

## Fora de escopo agora

- Mudar a tela pra modal único estilo `PaymentConciliationModal` (Opção 1 anterior).
- Tocar nas edge functions `run-retroactive-reconciliation` / `generate-retroactive-adjustment`.
- Mudar a regra de criação da apuração (continua exigindo médico e/ou PJ + período).

Confirma que sigo por aí?
