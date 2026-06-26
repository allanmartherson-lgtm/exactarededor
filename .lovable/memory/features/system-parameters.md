---
name: System Parameters — defaults + overrides
description: Padrão técnico para tirar configurações do hardcode; usado em parecer.classification e futuros parâmetros
type: feature
---

Configurações que antes ficavam hardcoded no código agora vivem em duas tabelas:

- **`system_parameter_defs`** — catálogo. 1 linha por parâmetro com `key` (ex: `parecer.classification`), `category`, `label`, `description`, `json_schema` e o `value` jsonb que é o **padrão global**. Editar aqui afeta todo escopo que não tenha override.
- **`system_parameter_overrides`** — exceções. 0..N linhas por parâmetro. Cada uma pode escopar por `hospital_id`, `convenio_slug`, `specialty` (qualquer combinação; pelo menos 1 obrigatório). Coluna gerada `priority` = quantos escopos não-nulos. Index único impede duplicar mesmo escopo.

**Resolução vigente:** RPC `public.resolve_system_parameter(key, hospital_id, convenio_slug, specialty)` retorna jsonb com `defaults.value || override.value` (override sobrescreve campos do default; campos não setados no override herdam). Faz match `IS NULL OR =`, ordena por `priority DESC, updated_at DESC`, pega 1.

**Por que dois níveis sem cópia:** unidade nova não recebe linha. Herda do `defs` automaticamente. Se o time mudar o padrão global, toda unidade sem override segue. Quem tem override (psiquiatria, p.ex.) fica intacto. Zero conflito.

**Tela:** `/sistema?tab=parametros` (`src/pages/SystemParameters.tsx`). Lista por categoria, mostra padrão + lista de exceções, dialog edita padrão ou cria/edita exceção (JSON textarea + schema como helper). Acesso: leitura `authenticated`, escrita só `admin` via `has_role`.

**Como adicionar novo parâmetro:**
1. `INSERT` em `system_parameter_defs` com `key`, `category`, `label`, `description`, `json_schema`, `value` default.
2. No código (edge function/UI), consumir via `supabase.rpc('resolve_system_parameter', { p_key, p_hospital_id, p_convenio_slug, p_specialty })` — passar o escopo do item/contexto.
3. Manter um default em código como fallback de rede de segurança caso RPC falhe.

**Parâmetros vigentes:**
- `parecer.classification` (categoria `parecer`) — consumido por `cross-reference-parecer`. Campos: `enabled` (bool), `consecutive_days_to_visita` (int 1-30), `dedup_key` (`specialty|doctor|doctor_or_specialty`). Default global: `{enabled:true, days:1, key:specialty}`.
