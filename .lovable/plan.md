## Objetivo
Reaproveitar o mesmo padrão de UX do "mapeamento de empresas" do cruzamento do lote (`PaymentConciliationModal`) em dois pontos da retroativa:

1. **Upload da base TASY** (dentro de `RetroactiveMappingWizard`) — quando a planilha traz coluna "Terceiro/PJ/Empresa", mostrar o mesmo modal para vincular cada texto encontrado a uma PJ cadastrada, com aliases e auto-match (hoje isso não existe na retroativa: qualquer valor entra cru).
2. **Criação de "TASY vs Repasse" com escopo Múltiplas empresas** — trocar os dois pickers atuais (Command multi-select de PJs + Command multi-select de médicos) por uma tabela idêntica ao lote: linha por PJ, com dot de status, badge, e coluna para escolher os médicos daquela PJ (usando `doctor_companies`).

## O que muda por arquivo

### `src/components/shared/CompanyMappingList.tsx` (novo)
Componente presentacional extraído de `PaymentConciliationModal` (linhas ~4090-4180). Recebe:
- `rows: { key: string; rawLabel: string; suggestedId: string|null; level: 'exact'|'high'|'medium'|null }[]`
- `options: { id: string; name: string }[]`
- `value: Record<key, string|null>` (mapping)
- `onChange(key, id|null)`
- `onConfirm(key)` (aceita sugestão medium)
- Slot opcional `extraColumn(key)` para renderizar coluna extra à direita (usada na criação: multi-select de médicos daquela PJ).

Sem lógica de aliases/auditoria: quem chama decide o que fazer no `onChange`. Isso mantém o batch com sua auditoria por `paymentId` intacta.

### `src/components/payment-detail/PaymentConciliationModal.tsx`
Substituir o bloco atual pelo `CompanyMappingList` mantendo os handlers já existentes (aliases + `logCompanyMapping`). Nada de comportamento muda.

### `src/components/retroactive/RetroactiveMappingWizard.tsx`
- Após o mapeamento de colunas, se a coluna `company_hint` estiver definida, entrar em um passo novo **"Vincular PJs"** usando `CompanyMappingList`.
- Auto-match com `companies.aliases` + fuzzy (mesma função `findMatch` do batch — extrair para `src/lib/companyMatching.ts`).
- Persistir aliases confirmados em `companies.aliases` (mesmo padrão do batch, sem auditoria por payment).
- Salvar o mapping resolvido em `retroactive_reconciliations.summary.company_mapping` para o motor usar depois.

### `src/components/retroactive/RetroactiveReconciliationsTab.tsx` (tela de criação)
Quando `mode = tasy_vs_repasse` e `scope = multi_pj`:
- Remover os dois Popover/Command atuais (PJs e Médicos).
- Renderizar `CompanyMappingList` alimentado com **todas as PJs do hospital** (checkbox por linha para incluir/excluir, no lugar do select terceiro→PJ). Coluna extra à direita = médicos daquela PJ (via `doctor_companies`), com checkboxes.
- Estado salvo continua em `multi_company_ids` e `multi_doctor_ids`.

### `src/lib/companyMatching.ts` (novo)
Extrair `findMatch`, `getIdentifiers`, `normFull` de `PaymentConciliationModal.tsx` para reuso entre batch e wizard.

## Detalhes técnicos
- `CompanyMappingList` fica em `src/components/shared/` (novo diretório) por ser cross-feature.
- O componente é 100% controlado — não faz fetch, não persiste nada. Toda regra de negócio (aliases, audit log, mapping storage) fica em quem consome.
- Auto-match do wizard usa as MESMAS `companies.aliases` do batch, então um alias aprendido em um fluxo vale para o outro.
- Zero mudança de schema.

## Fora do escopo
- Não mexer no motor de matching TASY×Repasse (já é canônico Atend+Data+TUSS+Médico).
- Não mexer no fluxo de "Alegação do médico" (permanece individual).

## Checagem final
- `tsgo` limpo.
- Fluxo do lote (`PaymentConciliationModal`) segue idêntico visualmente.
- Wizard retroativo ganha passo novo apenas quando há coluna de empresa mapeada.
- Criação "Múltiplas empresas" mostra a mesma tabela do lote.
