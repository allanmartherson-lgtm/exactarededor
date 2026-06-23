## Objetivo
Hoje o Zeev em `/pagamentos/novo` só conversa sobre **linhas suspeitas**. Com vários arquivos, o analista precisa: escolher setor em cada um, descartar rodapés/totalizadores, e confirmar PJ. Vamos transformar o Zeev em apoio ativo nessa etapa, mantendo a regra de **sempre confirmar antes de aplicar**.

## Mudanças

### 1. Insights automáticos de staging (aba "Apoio analítico")
Em `src/pages/NewPayment.tsx`, montar `extraInsights` a partir dos buckets e passar pro `ZeevAssistant`:

- **Setor faltando** — lista os N arquivos com `sectorMissing && !sectorMapping`. Ação: "Resolver com o Zeev" → muda pra aba **Conversar** e pré-preenche `"definir setor <X> para os arquivos: A.xlsx, B.xlsx"`.
- **PJ não confirmada** — arquivos com `matchScore < MATCH_AUTO_THRESHOLD` e sem `manualOverride`. Ação: rola até o card do arquivo (scroll-into-view via ref por bucket).
- **Linhas suspeitas pendentes** — usa `pendingSuspiciousCount` já calculado. Ação: muda pra aba **Conversar** e pré-preenche `"descartar todos os totalizadores"`.
- **Mapeamento incompleto** — buckets com `summary.missingRequired.length > 0`. Ação: abre o `ColumnMappingDialog` daquele bucket.

Os insights respeitam o `dismissed` (sessionStorage) já existente no Zeev.

### 2. Comando "definir setor" no executor de staging
- `supabase/functions/zeev-staging-executor/index.ts`: adicionar intent `set_sector_bulk` com `scope: { file_names?: string[]; all?: boolean }` e `payload: { sector: RuleSector }`. LLM passa a aceitar frases como *"setor CC em todos sem setor"* ou *"setor UPA no arquivo Brasilia.xlsx"*.
- `src/components/copilot/ZeevStagingChat.tsx`: renderizar **proposal card** com lista de arquivos afetados (nome + setor proposto), botão Confirmar/Cancelar igual ao de suspeitas. Ao confirmar, chama `staging.setBucketSectors(changes)`.
- `StagingContext` ganha:
  - `buckets: Array<{ idx; fileName; matchScore; manualOverride; sectorMissing; sectorMapping; sectorOptions }>`
  - `setBucketSectors: (changes: Array<{ idx: number; sector: RuleSector }>) => void`
- `NewPayment.tsx`: implementa `setBucketSectors` reutilizando o `setBuckets(prev => prev.map(...))` que já existe no seletor inline (linhas ~2900).

### 3. Pré-preenchimento da aba Conversar
- `ZeevAssistant`: aceita prop opcional `onOpenChatWith?: (prompt: string) => void` (não precisa — usar estado interno). Mais simples: quando o insight é clicado e tem `chatPrompt`, o Zeev troca pra `tab="chat"` e empurra a frase via prop nova `initialPrompt` do `ZeevStagingChat`.
- `ZeevStagingChat`: `useEffect` que, quando `initialPrompt` muda e não está vazio, preenche o textarea (não envia automaticamente — analista revisa).

### 4. Não-objetivos (continua fora de escopo do staging)
- CC e médico→PJ em lote no pré-envio. O LLM continua respondendo `unsupported` com mensagem explicando que essas ações ficam pós-envio (já implementado).

## Arquivos
- editar `src/pages/NewPayment.tsx` (montar `extraInsights`, expandir `stagingContext`)
- editar `src/components/copilot/ZeevAssistant.tsx` (aceitar `extraInsights` no modo staging, callback pra trocar aba + pré-preencher)
- editar `src/components/copilot/ZeevStagingChat.tsx` (renderizar proposal de setor, aceitar `initialPrompt`)
- editar `supabase/functions/zeev-staging-executor/index.ts` (intent `set_sector_bulk` + tools/whitelist)

## Confirmações antes de implementar
1. **Setor em lote no staging** — confirma que quando o analista pedir *"setor CC em todos sem setor"*, aplico **apenas** nos arquivos onde `sectorMissing && !sectorMapping`, ignorando arquivos que já têm setor escolhido?
2. **Mapeamento incompleto** — o insight só abre o diálogo do **primeiro** bucket com problema, ou lista todos com botão por arquivo?
3. **Auto-envio de comando** — quando o insight troca pra aba Conversar com frase pré-preenchida, eu **só preencho** (analista clica enviar), ou **envio automaticamente** já mostrando o proposal card?