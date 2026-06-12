# Aprendizado de validador → soft hints na próxima análise

Objetivo: consolidar feedbacks aceitos do `ProductionValidationPanel` em **padrões** reutilizáveis e, na próxima análise, **sinalizar** (não bloquear) itens que casam com esses padrões. Humano sempre decide.

## Decisões confirmadas
- **Fonte:** só `production_validation_feedbacks` com `status='aceito'` (validador → analista aceitou).
- **Modo:** soft — gera hint/badge no item, nunca muda status, nunca cria/edita regra automaticamente.
- **Sinais:** exclusões recorrentes, ausências recorrentes, overrides de valor, aceitar divergência.

## Modelagem

### 1. Nova tabela `learned_patterns`
Consolidação por chave estável. Uma linha = um padrão observado N vezes.

| campo | tipo | descrição |
|---|---|---|
| id | uuid pk | |
| hospital_id | uuid | tenancy |
| kind | text | `exclusao` \| `ausencia` \| `override_valor` \| `aceitar_divergencia` |
| scope | jsonb | chave canônica do padrão (ver abaixo) |
| signal | jsonb | dados agregados (motivo dominante, delta médio, etc.) |
| occurrences | int | contagem |
| first_seen_at / last_seen_at | timestamptz | |
| confidence | numeric | 0..1 (occurrences normalizado + concordância de motivo) |
| status | text | `ativo` \| `silenciado` \| `arquivado` |
| silenced_by / silenced_at / silenced_reason | auditoria humana |

Chave única: `(hospital_id, kind, scope_hash)` — `scope_hash` gerado via trigger MD5(scope::text canônico).

**`scope` por kind:**
- `exclusao`: `{company_id, tuss, convenio_id, exclusion_reason}`
- `ausencia`: `{company_id, doctor_id, tuss, convenio_id}`
- `override_valor`: `{company_id, tuss, convenio_id, direction: 'maior'|'menor'}` — analista corrige `gross_amount` consistentemente
- `aceitar_divergencia`: `{company_id, doctor_id, convenio_id}` — analista aceita diff repetidamente

### 2. Nova tabela `learned_pattern_events`
Audit trail: 1 linha por feedback/correção consumido. Permite recontar e reverter.
Campos: `pattern_id`, `source_kind` (`validation_feedback`|`item_override`|`accept_divergence`), `source_id`, `payment_id`, `payment_item_id`, `created_at`.

### 3. Nova tabela `payment_item_hints`
Snapshot por análise — evita recomputar a cada render.
Campos: `payment_item_id pk`, `hospital_id`, `pattern_id fk`, `kind`, `confidence`, `message`, `created_at`. Único por (item, pattern).

## Pipeline

```text
ProductionValidationPanel.resolve(status='aceito')
  └─> trigger DB after update on production_validation_feedbacks
      └─> upsert em learned_patterns (occurrences+1, last_seen_at, confidence)
      └─> insert em learned_pattern_events
```

```text
analyze-payment (final do cálculo de cada item)
  └─> match item contra learned_patterns ativos do hospital
      ├─ kind=exclusao  → hint "histórico: excluído N vezes por {motivo}"
      ├─ kind=ausencia  → hint "histórico: empresa costuma reportar ausência"
      ├─ kind=override  → hint "histórico: valor costuma ser corrigido para {direção}"
      └─ kind=aceitar   → hint "histórico: diferença costuma ser aceita"
  └─> insert payment_item_hints
```

## UI

- **PaymentItemRow / CompanyAnalysis:** badge amarelo `Lightbulb` "Aprendizado N×" com tooltip detalhando padrão e confiança. Click → drawer com histórico de eventos.
- **Nova página `/aprendizado-padroes`** (admin/diretor/senior): lista `learned_patterns` filtrável por kind/empresa/confiança, ações `silenciar` / `arquivar` / `ver eventos`. Reaproveita layout de `CompanyAliases`.
- **`ProductionValidationPanel`:** quando analista clica **Aceitar** num feedback, toast informa "padrão registrado, próxima análise será sinalizada".

## Confiança (simples e auditável)

```
confidence = min(1, occurrences / 5) * agreement_ratio
```
- `agreement_ratio` para `exclusao` = % do motivo dominante / total
- ≥0.6 vira hint visível; <0.6 fica latente (só na página de padrões)

## Permissões
- `learned_patterns` / `events` / `hints`: SELECT autenticado por hospital; INSERT/UPDATE só service_role (motor + trigger).
- Silenciar/arquivar via RPC `silence_learned_pattern(uuid, text)` que checa role admin/diretor/senior.

## Fora de escopo
- Criar/editar `rules` automaticamente (modo hard) — descartado.
- Aprender com glosas, magic link, validações que expiraram, feedbacks rejeitados.
- Cross-hospital pattern sharing.

## Arquivos a tocar
- `supabase/migrations/2026xxxx_learned_patterns.sql` (novo) — tabelas, trigger, RPC, GRANTs, RLS.
- `supabase/functions/analyze-payment/index.ts` — passo de matching + insert em `payment_item_hints`.
- `src/components/payment-detail/ProductionValidationPanel.tsx` — toast pós-aceitar.
- `src/components/payment-detail/PaymentItemRow.tsx` (ou equivalente) — badge de hint.
- `src/pages/CompanyAnalysis.tsx` — leitura dos hints + drawer.
- `src/pages/LearnedPatterns.tsx` (novo) + entrada em `navItems.ts`.
- `src/integrations/supabase/types.ts` (auto após migração).

Confirma que posso seguir nesse desenho?
