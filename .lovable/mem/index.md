# Project Memory

## Core
Analista envia base já tratada. Sistema só valida regras, calcula valores e aponta inconsistências — nunca estrutura planilha crua nem corrige formatação de origem.
Regra de pagamento nunca pode perder cálculos silenciosamente: redução exige confirmação explícita, snapshot e auditoria; delete direto de rule_calculations é proibido.
Especialidade médica é, por padrão, só relatório/busca/filtro — NÃO impacta cálculo nem status. EXCEÇÃO: quando o analista declara `specialties[]` num `rule_calculation`, o motor passa a filtrar o match por aquela especialidade (caso tabela de consultas, parecer/visita tarifado por especialidade). Vazio = sem filtro (comportamento histórico preservado para cirurgia/hemo). Separar campos operacionais (tipo ato, setor, convênio, TUSS, função) de informacionais (descrição, paciente).
Motor nunca aplica default hardcoded de repasse. Sem regra cadastrada = sem_regra + alerta, jamais valor inferido.
Glosa é por médico mas SEMPRE aplicada à PJ vinculada (doctor_companies). Médico sem PJ não pode receber repasse — espelha regra do Tasy.
Convênio, setor, médico e empresa sempre cruzam com tabela de cadastro (convenios/sectors/doctors/companies). Texto livre só como fallback com aviso.
Lookup de cadastros é ESTRITO: só aceita match por documento, nome exato ou alias cadastrado. Sem fuzzy. Sem match = bloqueia importação até analista resolver. Resolver canônico: src/lib/registryLookup.ts.
Normalização de convênio NÃO depende exclusivamente do banco: stems hardcoded em convenioStems.ts garantem que Bradesco/Sul América/Amil/Unimed resolvem mesmo com convenios vazia. Aliases aprendidos enriquecem a tabela automaticamente.
Notificações multi-canal: e-mail (Outlook/Gmail) + WhatsApp (Twilio). Aprovação por magic link assinado (JWT HS256, TTL 72h, single-use). Secret MAGIC_LINK_SECRET nunca expor.
Pool participant pode ser `company` (gera recebível) ou `hospital_nao_paga` (retenção = receita do hospital, NÃO entra na DRE de pagamento). NULL company_id só é válido com hospital_nao_paga — nunca tratar como bug.
Identidade visual: azul `#003DA5` + bronze `#C6A27C`, Playfair Display + DM Sans. Ícone oficial sempre via `<ExactaIcon />` (src/components/brand/ExactaIcon.tsx) — nunca recriar checkmark inline.
Escopo por hospital é INVARIANTE. Toda escrita operacional grava hospital_id do hospital ativo (nunca NULL, nunca inferido do cliente); toda leitura filtra por current_active_hospital(); IA/aprendizado/telemetria/dead-letter/hints por hospital — nenhum vazamento entre unidades. Cadastros globais explícitos: doctors, companies, item_types, payment_types, payment_models, specialties, manual_intervention_reasons, procedure_classifications, reference_tables, special_case_types. Centros de custo são por hospital (P12 padrão Rede D'Or, mas replicado por unidade via seed do DF Star).

## Memories
- [Setor nunca bloqueia importação](mem://constraints/sector-never-blocks-import) — Setor é aviso no painel, nunca gate; motor não usa setor no cálculo
- [Glosa sem aplicação parcial](mem://constraints/glosa-sem-parcial) — Sem líquido suficiente → adia integral; nunca grava status='partial'
- [Modais respeitam viewport](mem://design/modal-viewport-fit) — DialogContent/AlertDialogContent já limitam altura/largura e scroll interno; não patchar por modal
- [Guard obrigatório em edge functions](mem://constraints/edge-function-auth-guard) — requireInternalOrRole + CI enforce; PUBLIC_ALLOWLIST documenta exceções
- [Identidade Exacta/Rede D'Or](mem://design/brand-exacta-rededor) — Paleta, fontes, ícone oficial, favicon, pendências de marca

- [Escopo — base tratada](mem://constraints/scope-base-tratada) — Limites do que o sistema faz/não faz sobre a base enviada
- [Especialidade não impacta](mem://constraints/especialidade-nao-impacta) — Especialidade é só relatório/filtro, nunca afeta cálculo ou status
- [Sem default hardcoded](mem://constraints/no-hardcoded-default) — Motor não pode aplicar % default quando não há regra cadastrada
- [Tabelas exceção só vinculadas](mem://constraints/exception-tables-linked-only) — sem_acordo/exclusao só atuam quando referenciadas via exception_table_ids da regra
- [Cruzamento com cadastros](mem://constraints/registry-lookup-mandatory) — Convênio/setor/médico/empresa sempre via tabela; ordem id→doc→nome
- [Lookup estrito](mem://features/strict-registry-lookup) — Resolver canônico, tabelas de alias dedicadas, painel bloqueante na import
- [Repasse vs Acréscimo](mem://features/repasse-vs-acrescimo) — repasse_pct (multiplicativo) ≠ acrescimo_pct (aditivo) na tabela_diferenciada
- [Governança de cálculos de regras](mem://features/rule-calculation-governance) — Redução de cálculos exige confirmação, snapshot e auditoria; delete direto proibido
- [Infraestrutura Lovable Cloud](mem://preferences/infra-lovable-cloud) — Backend permanece no Lovable Cloud até revisão futura em produção estável
- [Glosa médico→PJ](mem://features/glosa-medico-pj) — Resolução automática doctor→doctor_companies→company; fallback manual em casos ambíguos
- [Glosa desconta da PJ](mem://constraints/glosa-desconta-pj-nao-medico) — Aplicação de glosa/débito NUNCA depende de produção do médico no lote; sai do líquido da PJ
- [Normalização de convênio](mem://features/convenio-normalization) — Pipeline 3 camadas + auto-aprendizado de aliases
- [Auto-aprendizado de aliases](mem://features/alias-auto-learning) — Todo vínculo aceito (manual/auto) abastece doctor/convenio/sector_aliases
- [Multi-tenant híbrido](mem://features/multi-tenant-hibrido) — Cadastros estaduais + operacional por hospital_id; DF Star é piloto; trigger herda hospital_id de pai
- [Notificações multi-canal + Magic Link](mem://features/notifications-magic-link) — E-mail/WhatsApp + aprovação assinada sem login
- [Supervisão de comunicação com SLA](mem://features/communication-supervision) — 3 canais unificados, SLA em horas úteis, ação "responder em nome de"
- [CRM unificado ou separado](mem://features/crm-formato-unificado) — Aceita "28923/DF" ou número+UF; auto-split na importação; match preciso por número+UF
- [Cadastro provisório de médico](mem://features/provisional-doctor-registration) — Analista cria pending; admin aprova em /medicos; gate bloqueia envio para validação até aprovação; loaders do registryLookup paginam (default 1000 quebrava lookup)
- [Códigos imutáveis + soft delete](mem://features/registry-immutable-codes) — doctors/companies/convenios/sectors/cost_centers têm code humano-legível imutável; DELETE bloqueado; só inativação
- [Comunicação em massa](mem://features/mass-communication) — Broadcast 1→N em tabela própria (comm_campaigns/recipients); nunca usa company_threads/doctor_messages; portal sempre + email/whatsapp opcionais
- [Cruzamento NF × pedido](mem://features/cruzamento-nf-pedido) — Tolerância zero contra bruto_total do grupo; divergente bloqueia nf_conciliada/lancado/pago; trigger DB
- [Confecção → Análise](mem://features/confeccao-to-analise) — Botão "Encaminhar para análise" troca analysis_mode/status e re-dispara motor; trigger DB bloqueia salto em_confeccao → validação/aprovação
- [Parecer × Visita no mesmo lote](mem://features/parecer-visita-subtype) — Reusa payment_type_id por item (não cria case_subtype); cross-reference auto-classifica; manual sempre vence
- [Histórico em modo seco](mem://constraints/historico-modo-seco) — import_mode='historico' calcula tudo mas não grava aliases auto (convenio/doctor/sector); só popula DRE
- [Modo manual — UI dedicada](mem://features/manual-mode-ui) — Lançamento manual tem layout/colunas/relatório próprios; observação em manual_note, anexo geral em payments.manual_general_attachment_*; sem regra/divergência/alerta
- [Lote de remessa — competência por item](mem://features/lote-remessa) — Eixo financeiro (rateio/DRE/locks) = competência do LOTE; item_competence é só dimensão analítica derivada da procedure_date
- [Parecer — período auto](mem://features/parecer-auto-period) — Período do relatório Tasy sempre derivado do arquivo; range maior que competência é cenário normal
- [Descompasso competência (produção)](mem://features/descompasso-competencia-producao) — Zeev sugere remessa quando ≥20% dos itens têm procedure_date fora da competence_month
- [Lote misto — parecer/visita em produção](mem://features/lote-misto-parecer) — Checkbox no wizard + ação retroativa: cruza relatório só nos itens com TUSS ambíguo (Parecer/Visita/Consulta)
- [Lote misto — tipo de pagamento por item](mem://features/lote-misto-tipo-pagamento) — payment_items.payment_type_id sobrescreve o lote; auto-classify por TUSS+heurística no dispatch; override manual sempre vence
- [Pool — retenção do hospital](mem://features/pool-hospital-retention) — hospital_nao_paga é receita do hospital (retenção em caixa), NÃO gera pagamento e NÃO entra na DRE de pagamento
- [Modelos de Repasse](mem://features/payout-models) — composição genérica (rubricas + faixas) para lançamentos manuais por equipe; substitui telas/tabelas por especialidade; coexiste com regras (rules calculam item; modelos montam a NF)
- [Rename híbrido payment_type_id](mem://preferences/payment-type-id-rename-hybrid) — UI camelCase: itemTypeId (item) / paymentModelId (lote); colunas DB seguem payment_type_id até Wave 5
- [KPI intervenção sem histórico](mem://constraints/intervention-kpi-excludes-historico) — get_intervention_savings ignora payments.import_mode='historico'
- [Teste do motor vive em /regras](mem://features/rule-engine-test-page) — Dry-run promovido para /regras?tab=teste-motor; snapshot do banco (não props stale); analyze-payment pagina 1000 em 1000

- [Migração CURA pausada](mem://constraints/cura-migration-paused) — Fase 3 aguardando tarball/registry; não reimplementar wrapper sem OK
- [Piso por procedimento](mem://features/piso-por-procedimento) — MAX(convenio, piso) por função em percentual_sobre_convenio; escopo por_atendimento ainda parcial
- [Escopo por hospital — invariante](mem://constraints/hospital-scope-invariant) — Regra completa: escrita, leitura, IA, cadastros globais permitidos, guardas
- [Centros de custo por hospital com clone](mem://features/cost-centers-per-hospital-clone) — P12 padrão Rede D'Or replicado por hospital; UNIQUE(hospital_id, code_p12); novo hospital = seed do DF Star
- [Planilha original para auditoria](mem://features/planilha-original-auditoria) — Tarefa aberta: arquivo bruto do TASY salvo em Storage por lote; RLS por hospital; imutável após pago
- [Bug weekdays/includes_holidays não persistem](mem://features/rule-weekdays-persistence-bug) — Form salva regra com weekdays={} + motor trata vazio como curinga; corrigir UI e motor
- [Financeiro por hospital](mem://constraints/financeiro-por-hospital) — Glosas, créditos, débitos, ajustes de PJ e deduções sempre gravam e filtram por hospital_id ativo; cada unidade tem autonomia total
