## Objetivo

Adicionar inteligência (determinística + IA) como **copiloto** em todo o sistema, sem tomar decisões automáticas (exceto onde for explicitamente autorizado). Reaproveitar fluxos de aprovação existentes — nada de painel novo.

---

## Etapa 1 — Detector de quase-match (determinístico, sem IA)

**Onde roda:** dentro do motor de matching (regra ↔ payment_item), depois que o match exato falha.

**Como funciona:**
- Quando match exato falha mas pilares fortes batem (atendimento + médico + TUSS), calcula similaridade do nome da empresa (Jaro-Winkler normalizado, ignorando "LTDA", "ME", acentos, pontuação).
- Score ≥ 0.92 → cria sugestão de vínculo `pending` com `source='engine_fuzzy'`, score, contexto (regra, item, pilares que bateram).
- Score 0.80–0.91 → mesma sugestão, mas marcada `confidence='low'`.
- Score < 0.80 → ignora (comportamento atual).
- Item segue com status `sem_regra` + alerta "sugestão pendente" até admin aprovar.

**Mesma lógica aplicada a:** nome de médico (quando CRM falha), nome de convênio (quando código falha), nome de setor.

---

## Etapa 2 — Aprovação reaproveita fluxo existente

**Nada de painel novo.** Estender a tabela `doctor_link_suggestions` (e criar análogas `company_link_suggestions`, `convenio_link_suggestions`, `sector_link_suggestions` se ainda não existirem) com colunas:
- `source` (`analyst_manual` | `engine_fuzzy` | `ai_suggested`)
- `score` numérico
- `context_jsonb` (regra_id, item_id, pilares que bateram)
- `ai_reasoning` texto (preenchido na etapa 3)

**UI:** na tela de aprovação que o admin já usa, adicionar:
- Filtro por origem (analista / motor / IA)
- Badge mostrando score e pilares que bateram
- Botão "Aprovar" → cria alias permanente + reprocessa itens afetados
- Botão "Rejeitar" → grava `status='rejected'`, motor nunca mais sugere o mesmo par

---

## Etapa 3 — Camada IA (Lovable AI Gateway, somente em casos ambíguos)

**Quando dispara (gate rígido para controlar custo):**
- Score fuzzy entre 0.80 e 0.92 (faixa cinzenta)
- OU múltiplos candidatos com scores parecidos
- OU contexto suspeito (mesma paciente, mesma data, mesmo TUSS, empresas diferentes)

**Como funciona:**
- Edge function chama `google/gemini-3-flash-preview` com prompt curto: nomes candidatos, contexto (CNPJ se houver, médico, convênio, regras vinculadas).
- Retorna JSON estruturado: `{ same_entity: bool, confidence: 0-1, reasoning: string }`.
- Resultado vira sugestão com `source='ai_suggested'` + `ai_reasoning` exibido ao admin.
- **IA nunca aprova sozinha** — só enriquece a sugestão.

**Custo controlado:** ~1 chamada por caso ambíguo por importação, não por item.

---

## Etapa 4 — Copiloto IA transversal na interface

IA como assistente em toda a UI, **nunca decidindo**, sempre sugerindo/explicando:

**4.1 — Tela de regra:**
- Botão "Explicar essa regra" → IA resume em linguagem natural o que a regra faz
- Detecta conflitos entre regras cadastradas (ex: duas regras cobrindo mesmo médico+convênio com bases diferentes) e sugere ajuste

**4.2 — Tela de payment / item:**
- Card "Análise IA" no item com problema: explica em uma frase por que ficou `sem_regra` / `valor_divergente` e sugere ação (cadastrar alias, criar regra, marcar exceção)
- Botão "Por que esse valor?" → IA narra o cálculo passo a passo (base × multiplicador × função)

**4.3 — Upload de planilha:**
- Após validação determinística, IA roda análise leve sobre as inconsistências e gera resumo executivo: "12 itens sem regra, 3 padrões dominantes — sugiro cadastrar regra X antes de processar"

**4.4 — Tela de cadastros (médico/empresa/convênio):**
- Ao colar nome, IA sugere possível duplicidade com cadastro existente (similaridade + contexto)

**4.5 — Telemetria de aprendizado (`match_telemetry`):**
- Tabela registrando: caso, score, decisão IA, decisão analista, tempo até decisão
- Após 1-2 meses, dashboard mostra ajuste sugerido de thresholds

---

## Detalhes técnicos

**Backend:**
- `supabase/functions/_shared/fuzzy.ts` — Jaro-Winkler + normalizador (stems já existentes em `convenioStems.ts`)
- `supabase/functions/engine-suggest-link/index.ts` — chamada pelo motor para criar sugestões
- `supabase/functions/ai-copilot/index.ts` — endpoint único do copiloto, recebe `{ context, question }`, roteia para prompt apropriado
- Migrations: estender tabelas `*_link_suggestions` com colunas novas + criar `match_telemetry`

**Frontend:**
- `src/components/copilot/CopilotCard.tsx` — componente reutilizável (card colapsável, ícone IA, badge "sugestão")
- Integração nas telas: Regra, PaymentDetail, Upload, Cadastros
- Filtro/badge na tela de aprovação de vínculos existente

**Modelo IA:** `google/gemini-3-flash-preview` (barato, rápido, estruturado via `Output.object`)

**Governança:**
- Toda sugestão IA é registrada em `match_telemetry` com prompt + resposta (auditável)
- Admin pode desligar copiloto por feature flag (`feature_flags.ai_copilot_enabled`)
- Nenhuma decisão automática — IA só preenche `pending`

---

## Ordem de implementação

1. Migrations (tabelas de sugestão estendidas + `match_telemetry` + feature flag)
2. Etapa 1: detector fuzzy no motor + criação de sugestões
3. Etapa 2: filtro/badge na tela de aprovação existente
4. Etapa 3: edge function `ai-copilot` + gate de ambiguidade
5. Etapa 4: componente `CopilotCard` + integrações por tela (incrementais, uma por vez)
6. Dashboard de telemetria (último, depois de coletar dados)

Posso começar pela Etapa 1 + migrations e seguir incrementalmente. Aprova?
