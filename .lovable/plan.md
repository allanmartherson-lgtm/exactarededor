## Zeev — Copiloto contextual de cadastros

Assistente IA flutuante que entende a tela aberta, diagnostica problemas (overlap, conflitos, regras inválidas), sugere correções e — quando autorizado — aplica edições. Memória por usuário no banco.

### Escopo das telas (fase 1)
Regras, Convênios, Médicos, Empresas, Setores, Casos Especiais. Cada tela publica seu "contexto" (o que está sendo editado) para o Zeev ler.

### Experiência

```text
┌─────────────────────────────────┐
│  [Tela de Regras — editando]    │
│                                 │
│  Cálculo A: ... ⚠ overlap       │
│  Cálculo B: ...                 │
│                          ╭───╮  │
│                          │ Z │ ← FAB sempre visível
│                          ╰───╯  │
└─────────────────────────────────┘
        ↓ clique
┌────────────────────────────┐
│  Zeev                      │
│  Vejo que você tem 2       │
│  cálculos sobrepondo no    │
│  eixo Convênio.            │
│                            │
│  [Aplicar correção]        │
│  [Explicar mais]           │
└────────────────────────────┘
```

- FAB no canto inferior direito, persistente em todas as telas de cadastro.
- Clique abre modal/drawer compacto com chat.
- Cada mensagem do Zeev pode trazer **ações sugeridas** (botões) que aplicam mudanças com confirmação.
- Histórico persistido por usuário+hospital — usuário continua a conversa depois.

### Inteligência

**Contexto que o Zeev recebe a cada pergunta:**
1. Tela ativa (rota) + nome legível ("Edição de Regra: Master ACME").
2. Snapshot dos dados em edição (regra + cálculos, ou cadastro aberto).
3. Diagnósticos do motor já disponíveis (problems do `detectCalcOverlap`, validações pendentes).
4. Conhecimento embutido sobre o sistema: precedência de regras, 11 eixos, whitelist/blacklist, glosa médico→PJ, especialidade não impacta cálculo, etc. (vem das memórias `.lovable/mem/`).

**Ações que o Zeev pode propor:**
- Adicionar/remover item em whitelist/blacklist de cálculo.
- Sugerir blacklist de convênio/especialidade para resolver overlap.
- Apontar regra/cálculo específico que está em conflito (com link "ir até").
- Sem ação destrutiva sem confirmação explícita. Sem `DELETE` direto em `rule_calculations` (respeita governança existente).

### Arquitetura técnica

**Backend (edge function `zeev-chat`):**
- Recebe `{ conversation_id, messages, screen_context }`.
- Usa AI SDK + Lovable AI Gateway, modelo `google/gemini-3-flash-preview`.
- System prompt embute as regras de ouro do projeto (precedência, eixos, constraints).
- Tools registradas:
  - `diagnose_rule_overlap(rule_id)` — chama `detectCalcOverlap` e retorna explicação.
  - `suggest_calc_edit(calc_id, patch)` — gera proposta (não aplica).
  - `apply_calc_edit(calc_id, patch)` — `needsApproval: true`, exige confirmação na UI.
  - `link_to_entity(type, id)` — gera link clicável para outra tela.
- Persiste mensagens em `zeev_messages`.

**Frontend:**
- `src/components/zeev/ZeevFab.tsx` — botão flutuante global, montado no layout dos hubs de cadastro.
- `src/components/zeev/ZeevChat.tsx` — drawer com `useChat` (AI SDK), markdown, ações inline.
- `src/contexts/ZeevContext.tsx` — cada tela registra seu `screen_context` (entidade aberta, dados em edição) via hook `useZeevContext({ screen, entity, snapshot })`.
- Componentes AI Elements: `Conversation`, `Message`, `MessageResponse`, `PromptInput`, `Tool`, `Shimmer`.
- Identidade visual própria do Zeev (não usar Sparkles genérico) — ícone/logo dedicado.

**Banco (migration nova):**

```text
zeev_conversations
  id uuid pk, user_id uuid, hospital_id uuid,
  title text, created_at, updated_at

zeev_messages
  id uuid pk, conversation_id uuid fk,
  role text ('user'|'assistant'|'tool'),
  parts jsonb,  -- UIMessage parts (AI SDK)
  screen_context jsonb,  -- snapshot da tela no momento
  created_at

zeev_action_log
  id uuid pk, conversation_id uuid fk,
  action_type text, payload jsonb,
  applied_by uuid, applied_at, rolled_back boolean
```

RLS: usuário só vê suas conversas; ações registradas em `audit_log` também.

### Fase 1 (este ticket) — entrega mínima viável
1. Schema + RLS + grants.
2. Edge function `zeev-chat` com streaming + 1 tool real: `diagnose_rule_overlap`.
3. FAB + drawer integrados no `RegrasHub` (única tela na fase 1, apesar do escopo amplo, para validar o padrão).
4. `ZeevContext` publicando regra/cálculos abertos.
5. Memória persistida; histórico recarregável.

### Fase 2 (depois de validar fase 1)
- Estender `useZeevContext` para Convênios, Médicos, Empresas, Setores, Casos Especiais.
- Tools de `apply_calc_edit` com confirmação.
- Tools de diagnóstico para cada tipo de cadastro (ex: convênio sem alias, médico sem PJ vinculada).
- "Explicar com Zeev" inline nos alertas de erro do motor.

### Por que faseado
Construir as 6 telas e todas as tools de uma vez tem alto risco de regressão. Validar primeiro em Regras (onde a dor é maior) garante que o padrão de `ZeevContext` + tools funcione antes de replicar.

### Pergunta restante
Posso prosseguir com a Fase 1 (Regras apenas) como entrega deste ciclo, ou prefere que eu já estruture o `ZeevContext` em todas as 6 telas mesmo que sem tools específicas?