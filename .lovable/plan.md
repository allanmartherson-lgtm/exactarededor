## Objetivo

Permitir que o analista defina uma ordenação personalizada multi-nível (estilo Excel: "Ordenar por A, depois por B…") aplicada **dentro de cada grupo de atendimento**. A ordem dos atendimentos entre si permanece inalterada — só reordena os itens de cada paciente.

## Escopo (arquivos)

Apenas **frontend**, tudo em `src/components/payment-detail/ItemsDataGrid.tsx`. Sem migration, sem edge function, sem alteração em arquivos compartilhados.

## UX

**1. Novo botão** ao lado do botão "Colunas" (canto direito da barra de filtros):

```text
[ Colunas ]  [ ↕ Classificar ]
```

Ícone `ArrowUpDown` (Lucide), label "Classificar". Quando houver 1+ nível ativo, mostra badge com o nº de níveis (ex.: `Classificar · 2`).

**2. Popover/Modal** aberto pelo botão, inspirado no diálogo do Excel:

```text
┌─ Classificação personalizada ───────────────────┐
│  Ordenar itens dentro de cada atendimento por:  │
│                                                 │
│  1. [Data do procedimento ▾]  [Crescente ▾]  ✕ │
│  2. [Paciente             ▾]  [A → Z      ▾]  ✕ │
│                                                 │
│  [+ Adicionar nível]                            │
│                                                 │
│  [ Limpar tudo ]              [ Aplicar ]       │
└─────────────────────────────────────────────────┘
```

- Cada nível: **campo** + **direção** + **remover**.
- Botão **+ Adicionar nível** empilha até 4 níveis.
- **Aplicar** persiste no `localStorage` (chave `medpay:items-grid:custom-sort:v1`) para sobreviver a refresh do lote.
- **Limpar tudo** volta ao default atual (status → gross desc).

**3. Campos ordenáveis** disponíveis:

- Data do procedimento (`procedure_date`)
- Paciente (nome)
- Convênio
- Médico
- Função (`doctor_function`)
- Código TUSS
- Procedimento (descrição)
- Valor bruto (`gross_amount`)
- Valor esperado (`expected_amount`)
- Diferença (`expected − gross`)
- Status (usa a mesma ordem de prioridade do default)
- Método de cálculo (`applied_calc_method`)

**4. Direção:** Crescente / Decrescente (com rótulos "A → Z" / "Z → A" para texto e "Menor → Maior" / "Maior → Menor" para numérico — só cosmético).

## Comportamento

- **Escopo:** aplicado **dentro de cada atendimento** (mesmo `attendance_number`). Itens sem atendimento continuam no fim, como hoje.
- **Preserva regras invioláveis já existentes:**
  - Ajustes de conciliação (`item_origem ≠ pagamento_atual`, não-bônus) continuam no fim absoluto.
  - Linhas de **bônus** continuam grudadas logo abaixo do item pai do mesmo atendimento.
  - Cluster de **pacote** continua no início do atendimento (a classificação personalizada roda **dentro** do cluster de pacote e dentro do cluster de "outros métodos", separadamente).
- **Coexistência com ordenação por clique no header:** clique em header continua funcionando como override global temporário (como hoje). Se houver custom-sort ativo E o usuário clicar num header, o clique vence naquela sessão e o custom-sort volta assim que o header for desselecionado. Um aviso no popover explica: *"Um cabeçalho está sendo usado para ordenar. Limpe-o para aplicar a classificação personalizada."*
- **Ordem entre atendimentos não muda.** A classificação personalizada nunca reordena os headers de atendimento entre si.

## Implementação técnica

1. **Novo tipo** `CustomSortLevel = { field: SortField; dir: "asc" | "desc" }` e estado `customSort: CustomSortLevel[]` persistido em `localStorage`.
2. **Novo botão** logo antes ou depois do `<Popover>` de "Colunas" (linhas 2425-2431).
3. **Novo componente inline** `CustomSortPopover` (~150 linhas) dentro do mesmo arquivo, seguindo o padrão do popover de Colunas para consistência visual.
4. **Aplicar ordenação:** dentro do bloco que reordena por atendimento (linhas 1798-1816), quando `customSort.length > 0` e não houver `sortKey` de header ativo, substituir o `sort estável por índice original` por um comparador multi-nível que:
   - primeiro respeita `clusterKey` (pacote antes de outros métodos — inviolável);
   - depois aplica cada nível de `customSort` na ordem;
   - desempata pelo índice original.
5. **Bônus:** a passagem que reancora bônus abaixo do pai (linhas 1663-1700) roda **depois**, então continua correta.

## Fora do escopo

- Não altera ordenação de headers de atendimento.
- Não altera export para Excel (mantém ordem atual do export).
- Não altera default para novos usuários (só quando o analista abrir o popover e aplicar).
- Nenhuma mudança de banco.
