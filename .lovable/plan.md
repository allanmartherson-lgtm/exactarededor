
# Zeev Executor — chat com ações automáticas

Transforma o Zeev de "observador" em "executor" via chat natural, com confirmação humana obrigatória, snapshot para rollback e log em `audit_log`.

## Princípios

- **Nada executa sem confirmar.** O LLM monta uma proposta; o usuário clica Confirmar.
- **Whitelist no servidor.** O LLM só chama tools cadastradas — não escreve SQL.
- **Reversível.** Toda ação grava snapshot dos valores antigos (`audit_log.before_state`).
- **Escopo limitado por rota.** Em `/pagamentos/novo` opera sobre o `staging` da importação; em `/pagamento/:id` opera sobre `payment_items` do lote.
- **Não toca `rule_calculations`.** Mantém a regra de governança existente.

## Tools liberadas (v1)

| Tool | O que faz | Confirmação | Reversível |
|---|---|---|---|
| `preview_items` | Lista itens que casam com filtro (somente leitura) | não | n/a |
| `bulk_set_sector` | Aplica `sector_code` em itens de um escopo | sim | sim (snapshot por item) |
| `bulk_set_cost_center` | Idem para `cost_center_code` | sim | sim |
| `bulk_link_doctor_company` | Cria/atualiza `doctor_companies` para médicos sem PJ | sim | sim (lista de IDs criados) |
| `bulk_mark_glosa_pattern` | Marca itens como glosa por descrição/convênio | sim | sim |

Cada tool recebe `scope` (filtros: `sem_setor`, `convenio_code`, `descricao_like`, `medico_code`, etc.) + payload (`sector_code`, etc.).

## Fluxo no chat

1. Usuário: *"coloca setor Centro Cirúrgico em todos sem setor identificado"*.
2. LLM chama `preview_items({ scope: { sector: null } })` → 47 itens.
3. LLM responde com **card de proposta**:
   - Ação, escopo, contagem, exemplos (3 itens), botões **Confirmar** / **Cancelar**.
4. Confirmar → roda `bulk_set_sector` (edge function) → grava `audit_log` → toast de sucesso + link "desfazer" (válido por 10 min).
5. Cancelar → descarta a proposta, mantém histórico no chat.

## Onde aparece

- **`/pagamentos/novo`** (esta tela): chat já existe (FAB Zeev). Ganha modo "executor" — tools operam sobre os itens do lote em criação.
- **`/pagamento/:id`** (detalhe): mesmo FAB, contexto = lote aberto.
- Mesma UI/componente, contexto trocado pela rota.

## Arquitetura técnica

```
Cliente (FAB Zeev)
  └─ useChat → /functions/v1/zeev-executor
                   ├─ streamText (Lovable AI, gemini-3-flash-preview)
                   ├─ tools: preview_items, bulk_set_sector, ...
                   │   ├─ execute=preview → roda direto
                   │   └─ execute=mutate → needsApproval=true (UI mostra card)
                   └─ onFinish → persiste mensagens (localStorage no v1)
```

### Persistência do chat

- **v1**: localStorage por `paymentId || "novo-lote"`. Sem threads — uma conversa por lote. Botão "limpar conversa".
- Suficiente porque o Zeev é assistente contextual, não histórico de longa duração.

### Auditoria

Toda ação grava em `audit_log`:
- `actor = 'zeev'`, `actor_user_id = auth.uid()`
- `action = 'bulk_set_sector'`
- `prompt_original = "coloca setor CC em..."`
- `affected_ids = [...]`, `before_state = {...}`, `after_state = {...}`
- `payment_id`, `hospital_id`

### Desfazer

Botão "desfazer" no toast → chama tool inversa lendo `before_state` do `audit_log` mais recente daquele usuário+ação. Janela: 10 min.

## Arquivos

**Novos:**
- `supabase/functions/zeev-executor/index.ts` — streamText + tools whitelisted
- `supabase/functions/zeev-executor/tools.ts` — definição/execução das 4 tools + preview
- `src/components/copilot/ZeevExecutorChat.tsx` — chat UI (AI Elements) com card de proposta
- `src/components/copilot/ProposalCard.tsx` — card de confirmação (ação, escopo, count, Confirmar/Cancelar)
- `src/hooks/useZeevExecutor.ts` — useChat + persistência localStorage por lote

**Alterados:**
- `src/components/copilot/ZeevAssistant.tsx` — adiciona aba "Conversar" ao lado do "Apoio analítico" atual
- `src/pages/NewPayment.tsx` e `src/pages/PaymentDetail.tsx` — passam `executorContext` para o FAB
- `supabase/migrations/<ts>_audit_log_zeev.sql` — colunas `prompt_original`, `before_state`, `after_state` se ainda não existem

## Fora de escopo (v1)

- Threads / histórico de conversas anteriores
- Ações que mexem em `rule_calculations`, `rules`, `pools`
- Ações financeiras (`payments`, `glosa_debts`)
- Execução agendada / disparo automático sem confirmação

## Verificação antes de fechar

1. Pedir setor em lote → preview mostra contagem certa.
2. Confirmar → itens atualizados, `audit_log` registrado.
3. Desfazer → estado anterior restaurado.
4. Cancelar → nada muda no banco.
5. Pedir ação fora da whitelist (ex: "deleta o lote") → Zeev recusa explicitamente.
