## O que muda

Na tabela de resultados da aba **Conciliação Retroativa** (`?tab=retroativa`), separar itens em duas sub-abas e esconder colunas técnicas por padrão, mostrando um detalhe expandível por linha.

### Sub-abas no topo da tabela de resultados

Duas pills logo acima da barra de filtros existente:

- **Por valor (% do convênio)** — regras `percentual_convenio` / `percentual_sobre_convenio`. Faz sentido comparar valor TASY hoje × valor pago.
- **Por presença (pacote / valor fixo / tabela diferenciada / bônus)** — regras onde TASY não é base de R$. Analisa quantidade, não valor.

Cada aba mostra a contagem de itens: *Por valor (128) · Por presença (34)*.
Seleção persiste em URL: `?tab=retroativa&analise=valor|presenca`.

### Colunas por aba (visíveis por padrão)

**Comuns às duas** (compactas, foco no que o analista age):

```text
[+] · Status · Atend · TUSS · Procedimento · Paciente · Data · Convênio · Médico · Função · Ação sugerida
```

**Ação sugerida** substitui hoje 3 colunas ("Dif. valor 100%", "Devido hoje", "Ajuste a fazer") por uma célula única com:

- badge colorido: `↓ Recuperar R$ X` / `↑ Complementar R$ X` / `— Sem ajuste`
- frase curta abaixo, gerada pelo motor:
  - *"TASY reduziu R$ 2.633 · acordo 100% convênio"*
  - *"Item cancelado no TASY · pacote (1 procedimento)"*
  - *"+1 quantidade no TASY · valor fixo R$ 411,88/un"*

**Exclusivas da aba Por valor:** Vlr total TASY hoje · Valor pago no lote

**Exclusivas da aba Por presença:** Qtd TASY hoje · Qtd paga · Dif. qtd · Valor pago no lote

### Detalhe expansível por linha

Ícone `[+]` na primeira coluna abre uma sub-linha (colspan total) com card contendo os campos técnicos ocultos do modo compacto:

```text
TASY hoje:      Vlr unitário R$ X · Vlr total R$ Y · Qtd Z
Lote histórico: Base convênio R$ A · Pago médico R$ B · Fator acordo N%
                Nº funções · Quais funções · Lote(s) de origem
Motor:          Dif. valor 100% · Devido hoje · Ajuste · Tipo análise
```

Botão "Expandir tudo / Recolher tudo" no header da tabela.

### Cabeçalho de grupos (linha superior)

Simplifica: uma faixa por aba em vez de 7 grupos.

- **Por valor**: `Contexto · TASY hoje · Lote histórico · Ação`
- **Por presença**: `Contexto · Quantidades · Lote histórico · Ação`

### Cards de resumo no topo

O bloco "Resumo de valores (grupo % sobre convênio)" já existe e só considera itens `tipo_analise=valor`. Vamos:

- Renomear para **"Resumo — Por valor"** e mostrar só quando aba ativa = valor.
- Adicionar espelho **"Resumo — Por presença"**: total de itens, quantidade divergente somada, valor a recuperar/complementar (calculado por `qtd × valor fixo` do acordo).

### Export

Mantido como está (uma planilha só, com todas as colunas técnicas + coluna nova `Análise = valor|presença` + `Ação sugerida`). Nada é escondido no XLSX/CSV — a compactação é só na UI.

## Fora do escopo

- Não muda o motor de cálculo, nem a chave de matching, nem o schema de `reconciliation_items`.
- Não altera a aba "Ativa" nem outras telas.
- Não muda o wizard de upload nem a lógica de encaminhamento pra apuração / glosa.

## Arquivos afetados

- `src/components/retroactive/RetroactiveReconciliationsTab.tsx` — único arquivo tocado. Refactor localizado: adiciona `analysisTab` (URL param), filtro em `visible`, `expandedKeys` set, define arrays de colunas por aba, gera cabeçalho/corpo a partir dos arrays, gera "Ação sugerida" a partir dos campos já calculados (`ajuste_acordo`, `tipo_analise`, `applied_calc_method`, `dif_qtd`, `dif_valor`).

## Detalhes técnicos

- `analysisTab` lido de `useSearchParams("analise")`; default `"valor"`.
- Contagem por aba: `results.filter(r => r.tipo_analise === "valor").length` etc.
- `expandedKeys: Set<string>` local; chave = `r.key` (já existe).
- Coluna "Ação sugerida" é derivada, sem novo campo no `TvrResult`. Frase:
  - `tipo_analise=valor` e `|ajuste_acordo| > 0.5`: `"TASY {subiu|reduziu} R$ {|dif_valor|} · acordo {fator}% convênio"`.
  - `tipo_analise=quantidade` e `dif_qtd < 0`: `"Cancelado no TASY · {applied_calc_method_pretty}"` + valor pago no lote como sugestão de retirada.
  - `tipo_analise=quantidade` e `dif_qtd > 0`: `"+{dif_qtd} no TASY · {applied_calc_method_pretty}"`.
  - Caso contrário: `"— Sem ajuste"`.
- Sub-linha expandida: `<TableRow><TableCell colSpan={N}><div className="p-3 bg-muted/30 rounded grid grid-cols-3 gap-3">...</div></TableCell></TableRow>`.
- Grupos de header: substituir a linha atual com 7 grupos (colSpans 3/8/3/6/2/1/1) por 4 grupos calculados dinamicamente conforme aba ativa.
- Aba `?tab=retroativa` continua funcionando; adiciona `&analise=valor|presenca` sem quebrar bookmarks antigos.

## Riscos

- Refactor de cabeçalho da tabela é a parte mais delicada (colSpans). Mitigar rendendo `<TableHead>` a partir do array de definição de coluna filtrado por aba, garantindo consistência automática entre grupo e coluna.
- Testes contratuais existentes na pasta `retroactive/__tests__` precisam continuar passando. Rodar a suíte após a mudança.
