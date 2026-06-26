
## Objetivo

Tirar do hardcode a regra "Parecer→Visita" do `cross-reference-parecer` e criar a **fundação** para outras configurações migrarem ao longo do tempo. Sem duplicar valor padrão por unidade — defaults vivem em um lugar único e cada unidade só grava o que **realmente sobrescreve**.

## Arquitetura: 2 camadas, sem cópia

```text
┌──────────────────────────────┐
│ system_parameter_defs        │  ← catálogo + valor PADRÃO global
│ key, category, schema, value │     (1 linha por parâmetro)
└──────────────┬───────────────┘
               │ inherits when no override
               ▼
┌──────────────────────────────┐
│ system_parameter_overrides   │  ← só existe quando alguém customiza
│ def_key, hospital_id,        │     (0..N linhas por parâmetro)
│ convenio_id, specialty,      │
│ value, priority              │
└──────────────────────────────┘
```

**Por que dois níveis:** quando um hospital novo é criado, **nada é copiado**. Ele herda o `defaults.value` automaticamente. Se amanhã o time mudar o padrão global (ex.: passar de 1 para 2 dias consecutivos), todas as unidades sem override pegam a mudança — zero migração, zero conflito. Unidades que tinham override (psiquiatria, p.ex.) continuam intactas.

**Resolução (mais específico vence):**
1. hospital + convênio + especialidade
2. hospital + especialidade
3. hospital + convênio
4. hospital
5. especialidade (global)
6. convênio (global)
7. `defaults.value`

## 1º parâmetro migrado: `parecer.classification`

JSONB no `value`:
```json
{
  "consecutive_days_to_visita": 1,
  "dedup_key": "specialty",
  "enabled": true
}
```

Default global = comportamento atual. Override de exemplo para psiquiatria:
```
def_key='parecer.classification', specialty='psiquiatria',
value={"enabled": false}   // psiquiatria nunca rebaixa pra visita
```

## Mudanças por área

### 1. Migração
- `system_parameter_defs` (key PK, category, label, description, json_schema, value jsonb, updated_*)
- `system_parameter_overrides` (id, def_key FK, hospital_id null, convenio_id null, specialty null, value jsonb, priority gerado, active, updated_*)
- Constraint: pelo menos um scope preenchido por linha de override
- Seed inicial: 1 linha em `defs` com `parecer.classification` + valor default atual
- RLS: leitura para `authenticated`; escrita só `admin` via `has_role`
- GRANTs explícitos nas duas tabelas

### 2. Edge function `cross-reference-parecer`
- Adiciona helper `resolveParam(supabase, key, {hospital_id, convenio_slug, specialty})` que faz a cascata
- Para cada item antes do dedup: resolve `parecer.classification` com o escopo do item
- Se `enabled=false` → pula reclassificação (psiquiatria fica como Parecer)
- Usa `consecutive_days_to_visita` no lugar do `=== 1`
- Usa `dedup_key` para escolher a chave de dedup (specialty | doctor | doctor_or_specialty)

### 3. Tela `/sistema-hub/parametros` (nova rota)
Layout simples, agrupa por `category`:

```text
Parâmetros do Sistema
─────────────────────────────────
[ Classificação Parecer/Visita ]
   Padrão global: 1 dia consecutivo, chave=especialidade
   [Editar padrão]

   Exceções ativas (3)
   ┌─────────────────────────────────────────┐
   │ Psiquiatria (qq hospital) → desativado  │
   │ Hospital DF Star → 2 dias               │
   │ Bradesco + Oncologia → chave=médico     │
   └─────────────────────────────────────────┘
   [+ Nova exceção]
```

- Dialog de edição reflete o `json_schema` do parâmetro (renderer genérico → futuros parâmetros entram sem reescrever UI)
- "Editar padrão" altera `defs.value`; "Nova exceção" cria linha em `overrides`
- Mostra preview: "Esta exceção afeta X regras vigentes em Y lotes recentes"

### 4. Memória
- Atualiza `parecer-visita-confeccao.md`: regra agora é parametrizada, default = 1 dia + specialty
- Cria `mem://features/system-parameters.md` explicando padrão defs/overrides para reuso futuro

## Detalhes técnicos

- `priority` em `overrides` = coluna gerada baseada em quantos campos de scope são não-nulos (3=mais específico, 1=menos). Query ordena `DESC` e pega o primeiro.
- Resolver é puro SQL via RPC `resolve_system_parameter(key, hospital, convenio, specialty)` retornando `jsonb` — uma chamada por item; cacheável no edge function por escopo.
- UI usa `zod` para validar contra `json_schema` antes de gravar.
- Sem breaking change: se `defs` estiver vazia, edge function cai no comportamento atual (fallback hardcoded mantido como rede de segurança nos primeiros lotes pós-deploy, removido depois).

## Fora de escopo (próximas iterações)

- Migrar outros hardcodes (RECONCILIATION_LOGIC_VERSION_DATE, tolerâncias, SLAs default) — entram aos poucos só adicionando linha em `defs`
- Versionamento/histórico de mudanças de parâmetro (audit_log já cobre por enquanto)
- Override por médico individual (não pedido)

## Entrega

1. Migração (defs + overrides + seed + RPC resolver + RLS + GRANTs)
2. Refactor `cross-reference-parecer` para usar resolver
3. Rota `/sistema-hub/parametros` + componentes
4. Memórias atualizadas
