
# Plano — Limpeza de Duplicatas de Regras (evento 12/jun/2026 00:52:12)

## Contexto

Em `2026-06-12 00:52:12` foram criadas **20 regras** em massa (mesmo timestamp exato, ao segundo). Todas colidem em `(hospital_id, name)` com regras já existentes. Das 20:

- **17** ficaram inativas (`active=false`) — ruído, mas sem efeito no motor
- **3** ficaram ativas e são as perigosas:
  - `Regra Cirurgia do Aparelho Digestivo (Bariátrica)` — 2 duplicatas ativas
  - `Regra Geral - Repasse 100% Convênio + Parecer + Visita + Consulta` — ativa
  - `Acordo Coluna` / `Acordo Flávio Brito` / `Acordo Ortopedia` — 1 ativa cada

Padrão comum: as duplicatas foram gravadas com `has_conditions=false` e `time_mode='qualquer'` — perdendo as restrições da regra original. É esse padrão que causou os bônus de FDS pagos em dias úteis (Otorrino, Cir. Geral).

Não há relação direta com o form de edição (`RuleCalculationsEditor`); trata-se de um evento de gravação em lote (script, seed, importação ou botão de "clonar/replicar"). A causa raiz precisa ser identificada antes de fechar.

## Objetivo

1. Neutralizar o efeito atual das duplicatas
2. Descobrir a origem do evento
3. Impedir que aconteça de novo

## Passos

### 1. Snapshot e auditoria (leitura)
- Exportar as 20 regras suspeitas + suas "originais" (mesma `(hospital_id, name)`) para `rule_snapshots` com motivo `"duplicate_cleanup_2026_06_12"`.
- Rodar diff campo-a-campo (weekdays, time_mode, has_conditions, exception_table_ids, calculations count) e gerar relatório.
- Consultar `audit_log` entre `2026-06-12 00:50:00` e `00:55:00` filtrando `entity='rules'` para identificar `actor_id` / rota / user-agent.
- Verificar `git log` das migrations e edge functions com deploy próximo a essa data.

### 2. Desativação segura das duplicatas
- Para cada duplicata onde existe uma "irmã" mais antiga com `has_conditions=true` ou config mais rica: `active=false` na duplicata, registrar em `audit_log` com `reason='duplicate_cleanup_2026_06_12'`.
- Para as 3 ativas problemáticas: revisar 1-a-1 antes de desativar (podem ter tido edições após 12/jun que valem preservar).
- Não deletar fisicamente (mantém histórico e evita quebra de FKs em `rule_calculations`, `rule_snapshots`, `payment_items.matched_rule_id`).

### 3. Recomputo dos pagamentos afetados
- Identificar `payment_items` com `matched_rule_id` apontando para uma das duplicatas desativadas.
- Estimar impacto financeiro por lote/PJ antes de reprocessar.
- Reprocessar apenas os lotes onde a mudança altera `expected_amount`; abrir glosa retroativa para os débitos e crédito manual para os créditos, conforme padrão já usado no caso do Jairo.

### 4. Hardening no banco
- Índice único parcial: `CREATE UNIQUE INDEX ON rules(hospital_id, lower(name)) WHERE active = true;` — impede duas regras ativas com mesmo nome no mesmo hospital.
- Trigger `BEFORE INSERT/UPDATE ON rules` que bloqueia gravar `time_mode IN ('fim_de_semana','dias_uteis','personalizado')` com `weekdays='{}'` e/ou `has_conditions=false` — inconsistência semântica.
- Ampliar `audit_log` para gravar `old_row`/`new_row` completos em qualquer operação de INSERT/UPDATE em `rules` (hoje só grava campos "importantes").

### 5. Hardening no código
- `calcToDbPayload` (`RuleCalculationsEditor.tsx`): derivar `weekdays` a partir de `time_mode` mesmo quando não é "personalizado" (defesa em profundidade).
- Motor (`rulesEngine.ts`): quando `time_mode ∈ {fim_de_semana, dias_uteis}` e `weekdays='{}'`, logar `data_integrity_warning` em `analysis_telemetry` e usar o preset como fonte da verdade (nunca cair em "qualquer dia").
- Se algum caminho de "clonar regra" existir na UI, garantir que copia `weekdays`, `exception_table_ids` e `has_conditions` — provável suspeito da origem.

### 6. Documentação
- Fechar `.lovable/mem/features/rule-weekdays-persistence-bug.md` com o diagnóstico real (não era o form, era o evento de duplicação).
- Abrir `.lovable/mem/features/rule-duplicate-cleanup-2026-06.md` registrando: causa raiz identificada, itens desativados, hardening aplicado.

## Detalhes técnicos

- **Ordem de execução:** 1 → 2 → 4 (constraint) → 5 → 3 (recompute com constraint já ativa) → 6.
- **Motivo:** aplicar a UNIQUE constraint antes do recompute evita que qualquer bug residual crie nova duplicata durante o reprocessamento.
- **Reversibilidade:** snapshot completo em `rule_snapshots` permite reativar qualquer duplicata desativada por engano.
- **Impacto no motor:** `active=false` já é filtro nativo do `rulesEngine`, então basta o UPDATE — nenhum código muda para a neutralização em si.

## O que fica de fora deste plano
- Correção dos 5 débitos do Jairo/Marcelo/Leonardo/Pedro/Rodrigo (já aplicada na etapa anterior).
- Upload da planilha original para auditoria (tarefa separada, sem urgência).

## Confirmação necessária antes de executar
- OK em desativar as **3 duplicatas ativas** listadas (Bariátrica x2, Repasse 100% Convênio Geral, Acordo Coluna/Flávio/Ortopedia)?
- OK em reprocessar automaticamente os lotes afetados no passo 3, ou prefere revisão manual item-a-item?
