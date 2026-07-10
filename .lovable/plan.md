## Fase 2 — Multi-select de bases na conciliação

Antes do plano, respondo direto às três dúvidas.

### 1) Multi-base é sempre necessário?

Não. É opcional e retrocompatível. O estado deixa de ser `selectedBase: Base | null` e vira `selectedBases: Base[]` (0, 1 ou N bases). Selecionar 1 base = comportamento atual idêntico. Quem só olha o mês corrente nunca precisa marcar mais de uma.

### 2) De onde vem `__baseCreatedAt`? É o "fechamento do TASY"?

**Honesto:** hoje o único timestamp disponível por base é `conciliation_bases.created_at` / `uploaded_at` — isso é **quando o analista subiu o arquivo**, não quando o TASY fechou. O TASY não devolve carimbo de fechamento no `raw_data` de forma padronizada.

Isso muda o critério de desempate. Proponho:

- **Chave de dedup**: `atendimento | TUSS (8d) | médico normalizado | função`.
- **Desempate primário**: `base.competence_month` — se um mesmo item aparece na base de Abril e na base de Março, **a base cuja competência bate com `payment.competence_month` vence**. Isso reflete a regra de negócio real (o item pertence à competência do lote que estamos analisando).
- **Desempate secundário**: `base.created_at` (upload mais recente) — só usado quando as competências das bases envolvidas são iguais, o que na prática significa "o analista subiu uma versão corrigida do mesmo mês".
- **Nome do campo carimbado**: renomear para `__baseCompetence` + `__baseUploadedAt` (dois carimbos, sem esconder a semântica).

Se no futuro conseguirmos extrair carimbo de fechamento do TASY (ex.: célula com data de emissão do relatório), viramos o desempate primário para esse campo — mas isso é fora do escopo desta fase.

### 3) O bucket âmbar sai sozinho quando a base chega?

**Sim, automaticamente e sem ação explícita.** O bucket `outra_competencia` é 100% derivado (`useMemo`) do conjunto atual de itens em memória. Quando a analista marca a base que faltava e clica "Processar":
- Os itens daquela competência entram no lookup consolidado.
- Os itens do Exacta que antes eram `so_exacta` sem match encontram par → viram `conciliado` ou `divergente` normalmente.
- O `useMemo` do bucket recalcula e o card âmbar decrementa.

Nenhum botão "reprocessar bucket". Nenhuma persistência extra. É o mesmo motor da Fase 1, só que agora com mais bases alimentando o lookup.

---

## O que muda no código

**Arquivo único:** `src/components/payment-detail/PaymentConciliationModal.tsx`.

**Estado:**
- `selectedBase: Base | null` → `selectedBases: Base[]`.
- Novo `primaryBaseId: string | null` — a base "primária" define o `col_map` e a lista de setores exibida na UI de mapeamento (evita conflito quando bases têm colunas diferentes). Default: primeira base marcada.

**UI da lista de bases:**
- Checkbox por linha em vez de rádio.
- Badge "primária" ao lado da primeira selecionada; clicar em outra troca a primária.
- Contador "N bases selecionadas · X linhas totais".
- Botão continua "Processar bases selecionadas".

**`handleProcessFromBase`:**
- Concatena `raw_data` de todas as bases selecionadas.
- Para cada linha, carimba dois campos: `__baseCompetence` (de `base.competence_month`) e `__baseUploadedAt` (de `base.created_at`).
- Aplica dedup determinístico com a chave e os desempates acima **antes** de mandar para o motor.
- Se houver conflito de `col_map` entre bases, usa o da primária e loga aviso no console (analista já viu antes de importar; não bloqueia).

**Bucket âmbar (`outraCompetenciaBuckets`):**
- Continua sendo `useMemo`. Só amplia a definição de "base disponível": agora considera qualquer base **não selecionada** cujo `competence_month` cobre o item — não só as importadas mas não carregadas antes.
- Rótulo do card se ajusta sozinho quando os buckets esvaziam.

**Persistência:** nenhuma. `saveColMapping` continua salvando só na base primária. Sem migração de banco.

**Retrocompatibilidade:** se `selectedBases.length === 1`, comportamento é indistinguível da Fase 1.

## Testes

- Unit test do dedup: 4 casos (mesma chave em 2 bases com competências diferentes → vence a que bate com o lote; mesma competência → vence upload mais recente; chaves distintas → mantém ambos; base única → passthrough).
- Teste manual no HDF Abril/2026 com bases de Março + Abril: os 46 itens hoje no bucket âmbar devem virar `conciliado`/`divergente` normais.

## Fora do escopo

- Persistir `selectedBases` no banco (hoje seleção já é volátil).
- Reprocessar automaticamente ao chegar uma base nova sem clicar em "Processar" (mantém controle explícito da analista).
- Extrair timestamp de fechamento do TASY do `raw_data`.

Ok para implementar?
