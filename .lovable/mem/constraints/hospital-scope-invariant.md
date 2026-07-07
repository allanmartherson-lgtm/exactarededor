---
name: Escopo por hospital é invariante do sistema
description: Toda escrita não-global grava hospital_id da unidade ativa; toda leitura filtra por ele; IA/aprendizado nunca cruza unidades
type: constraint
---

**Invariante inegociável do sistema.**

1. **Escrita**: toda linha de qualquer tabela operacional (pagamentos, itens, mensagens, pendências, telemetria de IA, dead-letter, aprendizados, threads, notificações, filas) grava `hospital_id` = hospital ativo do usuário no momento da inserção. Zero exceção. Se o hospital ativo não puder ser resolvido, a operação **falha** — nunca grava NULL.

2. **Leitura**: toda RLS/RPC/query operacional filtra por `hospital_id = current_active_hospital()`. Global-role só existe para administração cross-unit; usuários operacionais só enxergam a unidade ativa.

3. **IA & aprendizado**: `ai_analysis_versions`, `learned_patterns`, `learned_pattern_events`, `analysis_telemetry`, `analysis_dead_letter`, `ai_retry_queue`, `match_telemetry`, `payment_job_context`, `payment_pivot_cache`, `rule_calculations`, `rule_snapshots` são **por hospital**. Nenhum padrão aprendido, telemetria, hint ou snapshot da unidade A pode influenciar análise da unidade B.

4. **Cadastros globais** (permitidos com `hospital_id` NULL): `doctors`, `companies`, `cost_centers`, `item_types`, `payment_types`, `payment_models`, `specialties`, `manual_intervention_reasons`, `procedure_classifications`, `reference_tables`, `special_case_types`. Convenios/setores/aliases: NULL = global, UUID = exclusivo do hospital (comportamento já implantado 2026-07-07).

5. **Cliente ↔ servidor**: cliente **nunca** decide o hospital sozinho. A verdade é `user_active_hospital` (gravada pela RPC `set_active_hospital`). Antes de qualquer INSERT operacional, o front confirma no servidor via RPC.

6. **Guardas**: manter `active_hospital_scope` RESTRICTIVE em toda tabela operacional; qualquer nova tabela nasce com hospital_id NOT NULL + policy + trigger de default = `current_active_hospital()`.

**Por quê**: hospitais Rede D'Or são operações jurídicas e clínicas distintas. Vazamento entre unidades = risco regulatório (LGPD/dados de paciente), risco financeiro (pagamento cruzado) e contaminação do motor de IA (padrão da unidade A distorce cálculo da B).
