// v3: knowledge-card-response
// Zeev Executor — chat executor que propõe ações em lote no pagamento atual.
//
// Fluxo:
//   step=propose → LLM interpreta o pedido, devolve { action, scope, payload, summary, preview_count, sample_items }
//   step=execute → recebe a proposta + confirmação do usuário, aplica a mutação e grava audit_log
//
// Princípios:
//   - Whitelist de ações no servidor (LLM não escolhe SQL).
//   - Nada executa sem confirmação humana (UI mostra card e só então chama execute).
//   - Toda execução grava snapshot em audit_log.diff para rollback.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
import { maskPatients, unmaskDeep } from "../_shared/aiPrivacy.ts";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// -------------------- Tipos públicos --------------------

type Action =
  | "set_sector"
  | "set_cost_center"
  | "set_convenio"
  | "link_doctor_company"
  | "register_doctor_pending"
  | "register_company"
  | "resolve_registry_match"
  | "accept_keep_paid"
  | "accept_keep_expected"
  | "undo_accept"
  | "apply_manual_reason"
  | "navigate"
  | "answer";

interface Scope {
  /** Filtros declarativos. Todos opcionais; combinados com AND. */
  sector_missing?: boolean;
  cost_center_missing?: boolean;
  doctor_company_missing?: boolean;
  convenio_slug?: string | null;
  doctor_name_like?: string | null;
  procedure_code?: string | null;
  description_like?: string | null;
  /** Filtros de "ver"/responder — não disparam execução. */
  gross_zero?: boolean;
  ai_status_in?: string[];
  needs_human_review?: boolean;
}

interface Proposal {
  action: Action;
  scope: Scope;
  payload: Record<string, unknown>;
  summary: string;
  preview_count: number;
  sample_items: Array<{
    id: string;
    doctor_name: string | null;
    procedure_code: string | null;
    description: string | null;
    attendance_number: string | null;
  }>;
  /** Para ações de cadastro: pares chave→valor exibidos no card de confirmação. */
  details?: Array<{ label: string; value: string }>;
}

interface RequestBody {
  step: "propose" | "execute";
  /** Opcional — quando ausente, só ações sem mutação (navigate/answer) são possíveis. */
  payment_id?: string | null;
  /** Quando o analista está na tela de UMA empresa do lote, escopa contexto/aggregates. */
  company_group_id?: string | null;
  /** Nome da empresa visível na tela — autoritativo sobre qualquer derivação no servidor. */
  company_name?: string | null;
  /** Rota atual no app (para dar contexto de navegação ao Zeev). */
  current_path?: string | null;
  prompt?: string;
  proposal?: Proposal;
  /** Fase 2 — snapshot publicado pela tela ativa (regra em edição, conflitos, filtros). */
  screen_context?: Record<string, unknown> | null;
}

// -------------------- LLM prompt --------------------

const SYSTEM_PROMPT = [
  "Você é o Zeev — assistente do Exacta, sistema de repasse médico hospitalar.",
  "Você interpreta pedidos do analista e devolve UMA proposta estruturada. Você nunca executa direto: ações que mutam dados são confirmadas pelo analista; navegação é aplicada com 1 clique; respostas em texto são imediatas.",
  "",
  "REGRAS ABSOLUTAS:",
  "- NUNCA proponha apagar pagamentos, mexer em regras, aprovar lote, finalizar NF, ou qualquer ação financeira.",
  "- Use os números/contexto que o servidor já te passou (contagens, agregados, preferências aprendidas). Não invente.",
  "- Se 'learned_preferences' do contexto incluir uma preferência cujo 'when' bate com a situação atual (ex.: mesmo convenio_slug + sector_missing), proponha o mesmo payload aprendido. Mencione no summary que é uma preferência recorrente — mas SEMPRE espere confirmação humana.",
  "- Responda sempre em PT-BR, breve e direto. Sem rodeio.",
  "",
  "AÇÕES DISPONÍVEIS (escolha exatamente UMA):",
  "1) answer — quando o analista PERGUNTA algo respondível com o contexto. Use o 'summary' como a resposta completa em texto (pode ter 2-3 frases). Ideal para 'quantos itens estão zerados?', 'qual médico tem mais divergência?'.",
  "2) navigate — quando o analista quer IR a uma seção/filtro. payload: { url?: string, filter?: 'zerados'|'divergentes'|'sem_regra'|'reprovados' }. Use 'filter' para os 4 filtros padrão do grid. Use 'url' para rotas absolutas tipo '/pagamentos', '/regras', '/pendencias'. summary = 1 frase explicando para onde vai.",
  "3) set_sector — aplica setor em lote. payload: { sector_code }. Aceita código, nome OU slug do setor (ex.: 'SET-001', 'Outro', 'outro'). scope.sector_missing=true para 'sem setor'.",
  "4) set_cost_center — define o CENTRO DE CUSTOS DO LOTE (payments.cost_center_code), que propaga pra todos os itens. NÃO existe CC por item — é sempre lote-wide. payload: { cost_center_code } aceita código ou nome. Use sempre que o usuário mencionar centro de custos.",
  "5) link_doctor_company — vincula médico→PJ. payload: { company_id }. scope.doctor_company_missing=true.",
  "6) register_doctor_pending — cria médico em modo 'pending_admin_review=true'. payload: { full_name, crm, crm_uf (2 letras), cpf?, vinculo? } — full_name+crm+crm_uf são obrigatórios; se faltar, use 'clarify'. Use quando o analista pede 'cadastrar médico novo X com CRM Y/UF'.",
  "7) register_company — cria PJ. payload: { name, document (CNPJ — 14 dígitos), state_uf? } — name+document obrigatórios. Use quando pedir 'cadastrar empresa X CNPJ Y'.",
  "8) resolve_registry_match — registra alias para texto novo que devia bater com cadastro existente. payload: { alias_type: 'convenio'|'sector'|'doctor', alias_text, canonical_id (uuid do doctor) OU canonical_slug (slug do convenio/setor) }. Use quando o analista diz 'sempre que vier \"X\" considera como Y'.",
  "9) accept_keep_paid — acata em lote itens REPROVADOS/ALERTA mantendo o valor pago (gross_amount) como esperado. payload: { justification? (texto, opcional — usa default se não vier) }. scope opcional: ai_status_in (default ['reprovado','alerta']), doctor_name_like, procedure_code, convenio_slug, description_like.",
  "    GATILHOS (qualquer variação destas frases → accept_keep_paid, NÃO clarify):",
  "    - 'acatar mantendo o valor pago' / 'acatar mantendo valor pago' / 'acatar mantendo pago'",
  "    - 'manter o pago' / 'manter pago' / 'manter o valor pago' / 'mantém o pago'",
  "    - 'acatar sem mudar o valor' / 'acatar sem alterar o valor' / 'aceitar como está' / 'aceitar como veio'",
  "    - 'acata os reprovados' / 'acata os divergentes mantendo pago' / 'aprova mantendo pago'",
  "    - 'quero acatar os demais itens reprovados [como acatar] mantendo o valor pago' → SIM, é esta ação. Não peça setor nem nada.",
  "    Heurística: se o verbo for ACATAR/ACEITAR/APROVAR + qualificador MANTER/MANTENDO/SEM MUDAR/SEM ALTERAR/COMO ESTÁ/COMO VEIO/PAGO → use accept_keep_paid com scope.ai_status_in=['reprovado','alerta'] (ou só ['reprovado'] se o analista disser 'reprovados'). summary deve confirmar o que vai ser feito e quantos itens (use aggregates.reprovados/divergentes).",
  "10) accept_keep_expected — acata em lote adotando o VALOR ESPERADO da regra. payload: { justification? }. scope opcional igual ao accept_keep_paid. GATILHOS: 'acatar com valor esperado', 'acatar com valor da regra', 'acatar pelo esperado', 'acata usando o esperado', 'aprova adotando o valor calculado'.",
  "11) undo_accept — desfaz acatamentos em lote (volta status original e restaura gross original quando override foi acatado_pago/acatado_esperado). scope opcional: doctor_name_like, procedure_code, convenio_slug, description_like. GATILHOS: 'desfaz os acatados', 'reverte acatamento', 'volta os acatados', 'desacatar em lote'.",
  "12) set_convenio — vincula convênio em lote por filtro. payload: { convenio_slug } ou { convenio_name }. scope normalmente especifica doctor_name_like / procedure_code / description_like / convenio_slug (origem). GATILHOS: 'troca o convênio X por Y nos itens de M', 'aplica convênio Bradesco nos itens do Dr. Silva'.",
  "13) apply_manual_reason — marca um motivo de intervenção manual cadastrado em itens filtrados (sem alterar gross). payload: { reason_code } ou { reason_id }, notes? (opcional). scope: filtros normais. GATILHOS: 'aplica o motivo \"X\" nos itens Y', 'marca como tratamento manual com motivo X'.",
  "14) clarify — quando o pedido é ambíguo e você precisa perguntar de volta. summary = a pergunta.",
  "15) unsupported — quando não dá pra atender com nenhuma ação acima. summary = explicação curta + sugestão alternativa.",
  "",
  "REGRA DE OURO: se o analista usa verbo de VER/MOSTRAR/IR ('me mostra', 'leva pros zerados', 'abre os divergentes'), prefira 'navigate'. Se PERGUNTA ('quantos', 'qual', 'tem algum'), prefira 'answer'. Só use set_/link_/register_/resolve_ quando ele pedir explicitamente para APLICAR/CADASTRAR/VINCULAR. Para cadastro: extraia CRM no formato '12345/SP' como crm='12345', crm_uf='SP'. CNPJ pode vir com pontuação — preserve só dígitos.",
  "",
  "CONTEXTO DE ROTA: o servidor envia 'route_context' com sinais da tela em que o analista está. Use-os para responder perguntas vagas como 'tem coisa pra fazer aqui?'. Mapeamento:",
  "- /pendencias: route_context.abertas = nº de pendências em aberto. 'oldest_open' lista as 3 mais antigas. Pergunta tipo 'qual a mais antiga?' → answer com base nesses dados.",
  "- /medicos: route_context.pendentes_aprovacao = médicos criados via Zeev aguardando admin. 'tem médico pra aprovar?' → answer.",
  "- /empresas: total_ativas / sem_cnpj. 'quantas empresas sem CNPJ?' → answer.",
  "- /regras: sugestoes_pendentes (rule_suggestions). 'tem sugestão de regra?' → answer; 'me leva pra criar regra' → navigate /regras/novo.",
  "- /pagamentos (lista): em_analise, em_validacao. 'quanto tem em validação?' → answer.",
  "- /conversas, /comunicacao: campanhas_rascunho. 'tem campanha em rascunho?' → answer.",
  "- /glosas: itens_abertos. 'glosa aberta?' → answer.",
  "Sempre que existir um número exato no route_context, USE ele em vez de dizer 'não sei'. Se a rota não tem contexto específico, responda normalmente com aggregates do lote (quando houver) ou diga que precisa abrir a tela específica.",
  "",
  "CONCEITOS DE NEGÓCIO (use para responder dúvidas e diagnosticar problemas):",
  "",
  "* Regime de competência (produção vs remessa):",
  "  - Produção = lote referente a atendimentos realizados no mês da competência. Ex.: lote jan/2026 só com atendimentos de janeiro.",
  "  - Remessa = lote pago em determinado mês que AGREGA produção de meses anteriores. Ex.: pagamento de jan/2026 contendo atendimentos de nov/dez/jan. O eixo financeiro (rateio, DRE, locks) usa a competência DO LOTE; a procedure_date de cada item é só dimensão analítica.",
  "  - Diagnóstico: quando o lote é 'producao' mas ≥20% dos itens têm procedure_date fora da competence_month, isso indica que o lote DEVERIA ser 'remessa'. O componente ProducaoDescompassoBanner detecta automaticamente e oferece 'Mudar para remessa'.",
  "",
  "* Relatório de Parecer (Tasy):",
  "  - O período do relatório (período_inicio/período_fim) é SEMPRE auto-detectado das datas do arquivo (min/max de dt_solic_parecer / dt_resposta_parecer). Analista nunca preenche manualmente.",
  "  - Range maior que a competência do lote é NORMAL (analista pode subir base anual para analisar lote mensal). NUNCA sugira mudar para remessa por causa do range do parecer — o sinal de remessa vem da data dos itens da base de pagamento, não do relatório de parecer.",
  "",
  "* Pool de rateio:",
  "  - Soma dos percentuais dos participants deve SEMPRE = 100%.",
  "  - Existem dois tipos de participante (pool_participants.participant_type):",
  "      a) 'company' → tem company_id, gera recebível normal para a empresa.",
  "      b) 'hospital_nao_paga' → company_id é NULL por definição. Representa a fatia que fica RETIDA como receita do hospital (caixa hospital). NÃO gera pagamento, NÃO entra na DRE de pagamento (a DRE só mede pagamentos a empresas/médicos). O motor cria um grupo sintético com total_amount=0 só para auditoria.",
  "  - Portanto: participant com company_id NULL só é válido quando participant_type='hospital_nao_paga'. Qualquer outra combinação é dado corrompido (constraint do banco já bloqueia novos inserts).",
  "  - Quando o usuário perguntar onde foi parar a fatia 'que sumiu', explique que ela é retenção do hospital — receita dele, fora da DRE de pagamento.",
  "",
  "* Regras de repasse — CADASTRO E PRECEDÊNCIA (responda dúvidas de quem está editando em /regras):",
  "  - Uma REGRA tem escopo (médico/empresa/setor/grupo/master) e contém vários CÁLCULOS (rule_calculations). O motor primeiro escolhe a regra pelo escopo, depois escolhe o cálculo dentro dela.",
  "  - Precedência ENTRE regras (mais específica vence): medico_codigo > medico > grupo_doctor_codigo > grupo_doctor > empresa_codigo > empresa > grupo_empresa_codigo > grupo_empresa > setor_codigo > setor > setor_master_geral > default_setor > sem_regra.",
  "  - Precedência DENTRO da regra (entre cálculos): first_match por sort_order. Se dois cálculos restritivos batem no mesmo item, o motor lança erro_duplicidade_calculo (calc_overlap).",
  "  - Cálculo CATCH-ALL (sem filtros restritivos) é fallback: nunca dispara overlap, só pega o que sobrou.",
  "  - Os 11 EIXOS comparados para detectar overlap: (1) procedure_codes + code_match_mode, (2) extras_codes, (3) agreement_aliases + agreement_match_mode, (4) doctor_roles (função), (5) horário/dia (time_mode/weekdays), (6) elective_mode, (7) vias de acesso, (8) sectors, (9) specialties, (10) special_case_filter, (11) item_type_id. Para overlap acontecer, TODOS os 11 eixos precisam ter interseção; basta UM eixo vazio para os cálculos não conflitarem.",
  "  - WHITELIST vs BLACKLIST: whitelist = só esses; blacklist = qualquer um exceto esses; any = não restringe (universo). Para zerar a interseção em um eixo: use whitelist com lista disjunta, ou blacklist contendo o que o outro cálculo aceita.",
  "  - Solução típica de overlap 'Consulta Particular vs Especialidades': adicionar agreement_match_mode=whitelist + agreement_aliases=[particular] no cálculo Consulta Particular (efeito equivalente a blacklist=[particular] nas especialidades, mas com 1 edição em vez de N).",
  "  - Separar em duas regras só resolve overlap se o ESCOPO mudar (precedência entre regras decide). Se o escopo for o mesmo (ex: ambas master da mesma empresa), o detectCrossRuleOverlap aplica os mesmos 11 eixos e o conflito continua.",
  "  - GOVERNANÇA: redução do número de cálculos exige confirmação explícita + snapshot + auditoria. DELETE direto em rule_calculations é PROIBIDO. Sempre sugira EDITAR filtros antes de propor remover cálculo.",
  "  - Tabelas de exceção (sem_acordo/exclusao) só atuam quando referenciadas via exception_table_ids da regra. Item que cai em regra de 'exclusao' é resultado válido — NÃO é erro de pagamento.",
  "",
  "* Cadastros (convênios, médicos, empresas, setores):",
  "  - Lookup é ESTRITO: documento, nome exato ou alias cadastrado. Sem fuzzy. Sem match bloqueia importação até resolver.",
  "  - Convênio normaliza por stems hardcoded (convenioStems.ts) + tabela convenios + aliases aprendidos. Stems garantem que Bradesco/Sul América/Amil/Unimed resolvem mesmo com convenios vazia.",
  "  - Glosa: sempre por médico, mas APLICADA à PJ vinculada (doctor_companies). Médico sem PJ não recebe repasse — espelha regra do Tasy.",
  "  - Especialidade médica é APENAS relatório/busca/filtro — NUNCA impacta cálculo, status ou análise. Se o usuário disser 'minha regra de especialidade não aplica', explique que especialidade é eixo de FILTRO do cálculo, não disparador automático.",
  "  - Códigos de cadastros (doctors/companies/convenios/sectors/cost_centers) são imutáveis e DELETE é bloqueado — só inativação.",
  "",
  "ATITUDE EM /regras e telas de cadastro: quando o usuário relata erro ou faz dúvida conceitual, EXPLIQUE a regra de negócio aplicável (precedência, eixos, whitelist/blacklist) ANTES de propor ação. Use 'answer' com 2-4 frases didáticas e cite o eixo ou nível de precedência específico. Só use 'navigate' se ele pedir explicitamente para ir a outra tela.",
  "",
  "ESCOPO DE EMPRESA ('company_scope'): quando presente, o analista está na ANÁLISE DE UMA empresa do lote (rota /pagamentos/:id/empresa/:companyId). NESTE CASO:",
  "- Trate 'company_scope.company_name' como a empresa ATUAL — nunca cite outra empresa do lote.",
  "- 'aggregates' já vêm FILTRADAS por essa empresa (aggregates.scope = 'company'). Use aggregates.total / reprovados / divergentes / bruto_total como a verdade da tela.",
  "- 'company_scope.bruto_total' (vem da tabela payment_company_groups) e 'aggregates.bruto_total' (soma viva dos gross_amount dos itens) devem bater; se divergirem, mencione a divergência ao analista e sugira recalcular o lote.",
  "- Frases como 'essa empresa', 'aqui', 'nesta tela' referem-se SEMPRE a company_scope. NUNCA use o nome derivado do primeiro item do lote.",
  "",
  "CONTEXTO AO VIVO DA TELA ('screen_context'): quando presente, a UI publicou o estado exato do que o usuário está editando/vendo. Use SEMPRE em prioridade ao chute. Em particular:",
  "- screen_context.regras_conflict: o usuário está olhando um modal de conflitos detectados ao tentar salvar uma regra. Cada item em .problems já traz o tipo (calc_overlap | doctor_already_bound | company_already_bound | validity_overlap | master_already_exists) e os labels reais dos cálculos/regras envolvidos. Quando o usuário perguntar 'por que está dando conflito?' ou 'como resolver?', responda com 'answer' citando os labels exatos vindos do contexto e explicando o eixo da sobreposição (calc_overlap → 11 eixos do cálculo; validity_overlap → vigência; *_already_bound → mesma chave já vinculada a outra regra). Para calc_overlap, recomende WHITELIST do convênio específico no cálculo restritivo OU BLACKLIST no cálculo geral (regra de ouro: 'exceto', não duplicar regra).",
  "",
  "BASE DE CONHECIMENTO ('knowledge_articles'): quando presente, o servidor buscou artigos do manual do Exacta que podem responder a dúvida do analista. REGRAS:",
  "- Se o analista pergunta 'como…?', 'onde…?', 'o que é…?', 'o que faz…?', 'como funciona…?', 'tem manual?', 'me ajuda com…', 'me explica…' → use 'answer' e baseie sua resposta INTEIRAMENTE nos artigos do knowledge_articles. Reformule em suas palavras (tom amigável, direto), mas nunca invente passos que não estejam nos artigos.",
  "- Se knowledge_articles estiver vazio ou null e a pergunta for sobre uso do sistema → responda com 'answer' dizendo que ainda não tem essa informação no manual, mas sugira navegar para a tela relevante.",
  "- Perguntas operacionais sobre o sistema NÃO são 'unsupported' — são 'answer'. Só use 'unsupported' para pedidos que envolvam ação que o Zeev não pode fazer.",
  "",
  "CARTÃO RICO ('card'): SEMPRE que 'action=answer' for uma explicação/tutorial baseado em knowledge_articles (perguntas do tipo 'como…?', 'o que é…?', 'onde…?', 'me explica…'), popule o campo 'card' junto com 'summary'. O 'summary' permanece como texto curto de 1 frase (fallback), e o 'card' traz a versão estruturada.",
  "- card.title: nome curto do tema (ex.: 'Como criar um lote de pagamento').",
  "- card.icon: escolha o mais próximo — 'book' (tutorial), 'wallet' (pagamento/lote), 'settings' (regras/configuração), 'users' (médicos/PJs), 'building' (empresa/convênio), 'checklist' (conciliação/validação), 'zap' (ação rápida), 'lightbulb' (dica/conceito), 'info' (definição), 'file' (relatório).",
  "- card.intro: 1-2 frases de contexto.",
  "- card.sections: quebre a resposta em blocos. Para procedimentos passo a passo use 'steps' (lista de passos curtos, imperativos). Para conceitos use 'body'. Adicione 'tips' quando o artigo trouxer observações/cuidados.",
  "- card.actions (opcional, máx 3): CTAs de navegação para telas mencionadas nos artigos. SEMPRE kind='navigate' e url interna começando com '/'. Nunca invente URLs — só use rotas conhecidas (/pagamentos, /pagamentos/novo, /regras, /medicos, /empresas, /convenios, /setores, /centros-custo, /conversas, /comunicacao, /glosas, /creditos-debitos, /pendencias, /bi-diretoria, /bi-pagamentos, /auditoria-sobreposicao, /tabela-tuss).",
  "- Perguntas simples/factuais respondidas com dados do route_context (ex.: 'quantos itens zerados?') NÃO precisam de card — devolva só summary.",
].join("\n");


const RESPOND_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "set_sector",
        "set_cost_center",
        "set_convenio",
        "link_doctor_company",
        "register_doctor_pending",
        "register_company",
        "resolve_registry_match",
        "accept_keep_paid",
        "accept_keep_expected",
        "undo_accept",
        "apply_manual_reason",
        "navigate",
        "answer",
        "unsupported",
        "clarify",
      ],
    },
    scope: {
      type: "object",
      properties: {
        sector_missing: { type: "boolean" },
        cost_center_missing: { type: "boolean" },
        doctor_company_missing: { type: "boolean" },
        convenio_slug: { type: "string" },
        doctor_name_like: { type: "string" },
        procedure_code: { type: "string" },
        description_like: { type: "string" },
        gross_zero: { type: "boolean" },
        needs_human_review: { type: "boolean" },
        ai_status_in: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    payload: {
      type: "object",
      properties: {
        sector_code: { type: "string" },
        cost_center_code: { type: "string" },
        company_id: { type: "string" },
        url: { type: "string" },
        filter: { type: "string", enum: ["zerados", "divergentes", "sem_regra", "reprovados"] },
        full_name: { type: "string" },
        crm: { type: "string" },
        crm_uf: { type: "string" },
        cpf: { type: "string" },
        vinculo: { type: "string" },
        name: { type: "string" },
        document: { type: "string" },
        state_uf: { type: "string" },
        alias_type: { type: "string", enum: ["convenio", "sector", "doctor"] },
        alias_text: { type: "string" },
        canonical_id: { type: "string" },
        canonical_slug: { type: "string" },
        justification: { type: "string" },
        convenio_slug: { type: "string" },
        convenio_name: { type: "string" },
        reason_code: { type: "string" },
        reason_id: { type: "string" },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
    summary: { type: "string" },
    card: {
      type: "object",
      description: "Opcional — cartão rico para respostas tipo tutorial/explicação. Só use quando action='answer' e a resposta se beneficia de estrutura visual (passos, atalhos, dicas). Nunca invente conteúdo — baseie-se nos knowledge_articles.",
      properties: {
        icon: { type: "string", enum: ["book", "zap", "info", "lightbulb", "file", "settings", "users", "building", "wallet", "checklist"] },
        title: { type: "string" },
        intro: { type: "string", description: "1-2 frases de contexto antes das seções." },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string", description: "Parágrafo curto. Use quando não for lista de passos." },
              steps: { type: "array", items: { type: "string" }, description: "Passos numerados renderizados como timeline vertical." },
              tips: { type: "array", items: { type: "string" }, description: "Dicas/observações em bullets." },
            },
            additionalProperties: false,
          },
        },
        shortcuts: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, keys: { type: "string" } },
            required: ["label", "keys"],
            additionalProperties: false,
          },
        },
        actions: {
          type: "array",
          description: "CTAs no rodapé. Só use kind='navigate' com url interna (/pagamentos, /regras, etc). Máx 3.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              kind: { type: "string", enum: ["navigate"] },
              url: { type: "string" },
            },
            required: ["label", "kind", "url"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "sections"],
      additionalProperties: false,
    },
  },
  required: ["action", "summary"],
};

// -------------------- Helpers --------------------

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

async function buildItemsQuery(sb: SB, paymentId: string, scope: Scope) {
  let q = sb
    .from("payment_items")
    .select("id, doctor_id, doctor_name, procedure_code, description, attendance_number, sector, cost_center_code, convenio_slug, company_id, ai_status, manual_intervention_reason_id, gross_amount")
    .eq("payment_id", paymentId)
    .limit(1000);

  if (scope.sector_missing) q = q.or("sector.is.null,sector.eq.");
  if (scope.cost_center_missing) q = q.or("cost_center_code.is.null,cost_center_code.eq.");
  if (scope.convenio_slug) q = q.eq("convenio_slug", scope.convenio_slug);
  if (scope.procedure_code) q = q.eq("procedure_code", scope.procedure_code);
  if (scope.doctor_name_like) q = q.ilike("doctor_name", `%${scope.doctor_name_like}%`);
  if (scope.description_like) q = q.ilike("description", `%${scope.description_like}%`);
  if (scope.ai_status_in && scope.ai_status_in.length > 0) q = q.in("ai_status", scope.ai_status_in);

  const { data, error } = await q;
  if (error) throw new Error(`query_items: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    doctor_id: string | null;
    doctor_name: string | null;
    procedure_code: string | null;
    description: string | null;
    attendance_number: string | null;
    sector: string | null;
    cost_center_code: string | null;
    convenio_slug: string | null;
    company_id: string | null;
    ai_status: string | null;
    manual_intervention_reason_id: string | null;
    gross_amount: number | null;
  }>;
}

async function filterDoctorCompanyMissing(sb: SB, items: Array<{ doctor_id: string | null }>) {
  const ids = [...new Set(items.map((i) => i.doctor_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Set<string>();
  const { data } = await sb.from("doctor_companies").select("doctor_id").in("doctor_id", ids);
  const linked = new Set((data ?? []).map((r) => r.doctor_id as string));
  // retorna o set de doctor_ids SEM vínculo
  return new Set(ids.filter((d) => !linked.has(d)));
}

// -------------------- Execução de cada ação --------------------

async function resolveSector(sb: SB, input: string): Promise<{ code: string; name: string } | null> {
  const raw = input.trim();
  if (!raw) return null;
  // 1) match exato por code
  const byCode = await sb.from("sectors").select("code, name").eq("code", raw).maybeSingle();
  if (byCode.data) return byCode.data as { code: string; name: string };
  // 2) case-insensitive por code, slug ou name
  const ilike = await sb
    .from("sectors")
    .select("code, name, slug")
    .or(`code.ilike.${raw},slug.ilike.${raw.toLowerCase()},name.ilike.${raw}`)
    .limit(1);
  const hit = (ilike.data ?? [])[0] as { code: string; name: string } | undefined;
  return hit ?? null;
}

async function resolveCostCenter(sb: SB, input: string): Promise<{ code: string; name: string } | null> {
  const raw = input.trim();
  if (!raw) return null;
  const byCode = await sb.from("cost_centers").select("code, name").eq("code", raw).maybeSingle();
  if (byCode.data) return byCode.data as { code: string; name: string };
  const ilike = await sb
    .from("cost_centers")
    .select("code, name")
    .or(`code.ilike.${raw},name.ilike.${raw}`)
    .limit(1);
  const hit = (ilike.data ?? [])[0] as { code: string; name: string } | undefined;
  return hit ?? null;
}

async function execSetSector(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const sectorInput = String(payload.sector_code ?? payload.sector ?? "").trim();
  if (!sectorInput) throw new Error("sector_code obrigatório");

  const secRow = await resolveSector(sb, sectorInput);
  if (!secRow) throw new Error(`Setor "${sectorInput}" não encontrado no cadastro (tente código, nome ou slug).`);

  const items = await buildItemsQuery(sb, paymentId, scope);
  if (items.length === 0) return { affected: 0, before: [], after: { sector: secRow.name } };

  const before = items.map((i) => ({ id: i.id, sector: i.sector }));
  const { error } = await sb
    .from("payment_items")
    .update({ sector: secRow.name, sector_matched_by: "zeev_bulk" })
    .in("id", items.map((i) => i.id));
  if (error) throw new Error(`update_sector: ${error.message}`);
  return { affected: items.length, before, after: { sector: secRow.name } };
}

async function execSetCostCenter(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const ccInput = String(payload.cost_center_code ?? payload.cost_center ?? "").trim();
  if (!ccInput) throw new Error("cost_center_code obrigatório");

  const ccRow = await resolveCostCenter(sb, ccInput);
  if (!ccRow) throw new Error(`Centro de custos "${ccInput}" não encontrado.`);

  // CC vive no nível do LOTE (payments.cost_center_code). Se o usuário pediu
  // "aplicar em itens sem CC" ou não restringiu por filtro específico, atualiza
  // o lote inteiro — é assim que CC funciona no Exacta (lote propaga p/ itens).
  const isLoteWide = !!scope.cost_center_missing || (
    !scope.convenio_slug && !scope.procedure_code && !scope.doctor_name_like && !scope.description_like
  );

  if (isLoteWide) {
    const { data: payBefore } = await sb
      .from("payments")
      .select("cost_center_code")
      .eq("id", paymentId)
      .maybeSingle();
    const { error: payErr } = await sb
      .from("payments")
      .update({ cost_center_code: ccRow.code })
      .eq("id", paymentId);
    if (payErr) throw new Error(`update_lote_cc: ${payErr.message}`);
    return {
      affected: 1,
      before: [{ payment_id: paymentId, cost_center_code: (payBefore as { cost_center_code?: string | null } | null)?.cost_center_code ?? null }],
      after: { scope: "lote", cost_center_code: ccRow.code, cost_center_name: ccRow.name },
    };
  }

  const items = await buildItemsQuery(sb, paymentId, scope);
  if (items.length === 0) return { affected: 0, before: [], after: { cost_center_code: ccRow.code } };

  const before = items.map((i) => ({ id: i.id, cost_center_code: i.cost_center_code }));
  const { error } = await sb
    .from("payment_items")
    .update({ cost_center_code: ccRow.code })
    .in("id", items.map((i) => i.id));
  if (error) throw new Error(`update_cc: ${error.message}`);
  return { affected: items.length, before, after: { cost_center_code: ccRow.code } };
}

async function execLinkDoctorCompany(sb: SB, paymentId: string, scope: Scope, payload: Record<string, unknown>) {
  const companyId = String(payload.company_id ?? "").trim();
  if (!companyId) throw new Error("company_id obrigatório");

  const { data: comp } = await sb.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!comp) throw new Error("Empresa não encontrada.");

  const items = await buildItemsQuery(sb, paymentId, scope);
  const missing = await filterDoctorCompanyMissing(sb, items);
  const doctorIds = [...missing];
  if (doctorIds.length === 0) return { affected: 0, before: [], after: { company_id: companyId, company_name: comp.name }, created_link_ids: [] };

  const rows = doctorIds.map((doctor_id) => ({
    doctor_id,
    company_id: companyId,
    start_date: new Date().toISOString().slice(0, 10),
  }));
  const { data: inserted, error } = await sb
    .from("doctor_companies")
    .insert(rows)
    .select("id, doctor_id");
  if (error) throw new Error(`link_doctor_company: ${error.message}`);

  return {
    affected: inserted?.length ?? 0,
    before: doctorIds.map((d) => ({ doctor_id: d, had_link: false })),
    after: { company_id: companyId, company_name: comp.name },
    created_link_ids: (inserted ?? []).map((r) => r.id),
  };
}

async function execAcceptKeepPaid(
  sb: SB,
  paymentId: string,
  scope: Scope,
  payload: Record<string, unknown>,
  actorId: string,
) {
  const scopeWithStatus: Scope = {
    ...scope,
    ai_status_in: scope.ai_status_in && scope.ai_status_in.length > 0
      ? scope.ai_status_in
      : ["reprovado", "alerta"],
  };
  const items = await buildItemsQuery(sb, paymentId, scopeWithStatus);
  // Filtra apenas itens ainda não tratados manualmente
  const targets = items.filter((i) => !i.manual_intervention_reason_id);
  if (targets.length === 0) {
    return { affected: 0, before: [], after: { reason: "acatado_pago" } };
  }

  const justification = String(payload.justification ?? "").trim()
    || "Acatado em lote via Zeev — mantendo o valor pago como esperado.";
  const justifFinal = justification.length < 20
    ? justification + " (acatamento em lote pelo assistente)"
    : justification;

  // Busca um reason genérico de "manter pago" se existir
  const { data: reasons } = await sb
    .from("manual_intervention_reasons")
    .select("id, code")
    .or("code.ilike.%manter_pago%,code.ilike.%acatado_pago%,code.ilike.%keep_paid%")
    .limit(1);
  const reasonId = (reasons?.[0]?.id as string | undefined) ?? null;

  const ids = targets.map((t) => t.id);
  const nowIso = new Date().toISOString();
  const before = targets.map((t) => ({
    id: t.id,
    ai_status: t.ai_status,
    gross_amount: t.gross_amount,
  }));

  const patch: Record<string, unknown> = {
    ai_status: "acatado",
    acatado_by: actorId,
    acatado_at: nowIso,
    gross_override_at: nowIso,
    gross_override_by: actorId,
    gross_override_reason: "acatado_pago",
    manual_intervention_source: "zeev_bulk",
    manual_intervention_by: actorId,
    manual_intervention_at: nowIso,
    manual_intervention_notes: justifFinal,
  };
  if (reasonId) patch.manual_intervention_reason_id = reasonId;

  const { error } = await sb.from("payment_items").update(patch).in("id", ids);
  if (error) throw new Error(`accept_keep_paid: ${error.message}`);

  // Salva acatado_status_original em itens onde estava ai_status original (reprovado/alerta)
  // (best-effort — não bloqueia se falhar)
  for (const t of targets) {
    await sb
      .from("payment_items")
      .update({ acatado_status_original: t.ai_status })
      .eq("id", t.id)
      .is("acatado_status_original", null);
  }

  return {
    affected: targets.length,
    before,
    after: { reason: "acatado_pago", justification: justifFinal, reason_id: reasonId },
  };
}

async function execAcceptKeepExpected(
  sb: SB,
  paymentId: string,
  scope: Scope,
  payload: Record<string, unknown>,
  actorId: string,
) {
  const scopeWithStatus: Scope = {
    ...scope,
    ai_status_in: scope.ai_status_in && scope.ai_status_in.length > 0
      ? scope.ai_status_in
      : ["reprovado", "alerta"],
  };
  const items = await buildItemsQuery(sb, paymentId, scopeWithStatus);
  // Carrega expected_amount + estado de override (não vinha no select padrão)
  const ids = items.filter((i) => !i.manual_intervention_reason_id).map((i) => i.id);
  if (ids.length === 0) return { affected: 0, before: [], after: { reason: "acatado_esperado" } };

  const { data: extra } = await sb
    .from("payment_items")
    .select("id, ai_status, gross_amount, gross_amount_original, expected_amount, gross_override_at")
    .in("id", ids);
  const targets = (extra ?? []).filter((r: any) =>
    r.expected_amount != null && Number.isFinite(Number(r.expected_amount)),
  );
  if (targets.length === 0) return { affected: 0, before: [], after: { reason: "acatado_esperado", note: "nenhum item com esperado válido" } };

  const nowIso = new Date().toISOString();
  const justification = String(payload.justification ?? "Acatado em lote via Zeev — adotando valor esperado.").trim();

  // Atualiza em lotes individuais para preservar gross_amount_original só na 1ª sobrescrita
  const before: any[] = [];
  let affected = 0;
  for (const t of targets as any[]) {
    const wasOverridden = !!t.gross_override_at;
    const patch: Record<string, unknown> = {
      acatado_status_original: t.ai_status,
      ai_status: "acatado",
      acatado_by: actorId,
      acatado_at: nowIso,
      gross_amount: Number(t.expected_amount),
      gross_override_at: nowIso,
      gross_override_by: actorId,
      gross_override_reason: "acatado_esperado",
    };
    if (!wasOverridden) patch.gross_amount_original = t.gross_amount;
    const { error } = await sb.from("payment_items").update(patch).eq("id", t.id);
    if (!error) {
      before.push({ id: t.id, ai_status: t.ai_status, gross_amount: t.gross_amount });
      affected++;
    }
  }
  return { affected, before, after: { reason: "acatado_esperado", justification } };
}

async function execUndoAccept(
  sb: SB,
  paymentId: string,
  scope: Scope,
  _payload: Record<string, unknown>,
  actorId: string,
) {
  const scopeWithStatus: Scope = { ...scope, ai_status_in: ["acatado"] };
  const items = await buildItemsQuery(sb, paymentId, scopeWithStatus);
  if (items.length === 0) return { affected: 0, before: [], after: { event: "acate_desfeito" } };

  const ids = items.map((i) => i.id);
  const { data: rows } = await sb
    .from("payment_items")
    .select("id, ai_status, acatado_status_original, gross_amount, gross_amount_original, gross_override_reason")
    .in("id", ids);

  const before: any[] = [];
  let affected = 0;
  for (const r of (rows ?? []) as any[]) {
    const restoreStatus = r.acatado_status_original || "reprovado";
    const isExpectedOverride = r.gross_override_reason === "acatado_esperado" || r.gross_override_reason === "acatado_pago";
    const patch: Record<string, unknown> = {
      ai_status: restoreStatus,
      acatado_by: null,
      acatado_at: null,
      acatado_status_original: null,
    };
    if (isExpectedOverride) {
      if (r.gross_amount_original != null) patch.gross_amount = r.gross_amount_original;
      patch.gross_amount_original = null;
      patch.gross_override_at = null;
      patch.gross_override_by = null;
      patch.gross_override_reason = null;
    }
    const { error } = await sb.from("payment_items").update(patch).eq("id", r.id);
    if (!error) {
      before.push({ id: r.id, ai_status: "acatado", gross_amount: r.gross_amount });
      affected++;
    }
  }
  // log apenas resumido — auditoria por item ficaria muito verbosa
  await sb.from("audit_log").insert({
    entity_type: "payment",
    entity_id: paymentId,
    action: "zeev.undo_accept_bulk",
    actor_id: actorId,
    diff: { event: "acate_desfeito_lote", affected, item_ids: ids.slice(0, 50) },
  });
  return { affected, before, after: { event: "acate_desfeito" } };
}

async function execSetConvenio(
  sb: SB,
  paymentId: string,
  scope: Scope,
  payload: Record<string, unknown>,
) {
  const input = String(payload.convenio_slug ?? payload.convenio_name ?? payload.convenio ?? "").trim();
  if (!input) throw new Error("convenio_slug ou convenio_name obrigatório.");

  // resolve por slug exato, depois ilike em slug/name
  let resolved: { slug: string; name: string } | null = null;
  const bySlug = await sb.from("convenios").select("slug, name").eq("slug", input.toLowerCase()).maybeSingle();
  if (bySlug.data) resolved = bySlug.data as any;
  if (!resolved) {
    const ilike = await sb
      .from("convenios")
      .select("slug, name")
      .or(`slug.ilike.${input.toLowerCase()},name.ilike.%${input}%`)
      .limit(1);
    resolved = ((ilike.data ?? [])[0] as any) ?? null;
  }
  if (!resolved) throw new Error(`Convênio "${input}" não encontrado no cadastro.`);

  const items = await buildItemsQuery(sb, paymentId, scope);
  if (items.length === 0) return { affected: 0, before: [], after: { convenio_slug: resolved.slug } };

  const before = items.map((i) => ({ id: i.id, convenio_slug: i.convenio_slug }));
  const { error } = await sb
    .from("payment_items")
    .update({ convenio_slug: resolved.slug, convenio_matched_by: "zeev_bulk" })
    .in("id", items.map((i) => i.id));
  if (error) throw new Error(`update_convenio: ${error.message}`);
  return { affected: items.length, before, after: { convenio_slug: resolved.slug, convenio_name: resolved.name } };
}

async function execApplyManualReason(
  sb: SB,
  paymentId: string,
  scope: Scope,
  payload: Record<string, unknown>,
  actorId: string,
  hospitalId: string | null,
) {
  const code = String(payload.reason_code ?? payload.code ?? "").trim();
  const reasonIdInput = String(payload.reason_id ?? "").trim();
  if (!code && !reasonIdInput) throw new Error("reason_code ou reason_id obrigatório.");

  let reason: { id: string; code: string; label?: string | null } | null = null;
  if (reasonIdInput) {
    const r = await sb.from("manual_intervention_reasons").select("id, code, label").eq("id", reasonIdInput).maybeSingle();
    reason = (r.data as any) ?? null;
  } else {
    // tenta match exato global ou do hospital
    let q = sb.from("manual_intervention_reasons").select("id, code, label, hospital_id").or(`code.eq.${code},code.ilike.${code}`);
    if (hospitalId) q = q.or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`);
    const { data } = await q.limit(5);
    const list = (data ?? []) as any[];
    // prioriza hospital_id != null se ambíguo
    reason = list.find((r) => r.hospital_id) ?? list[0] ?? null;
  }
  if (!reason) throw new Error(`Motivo "${code || reasonIdInput}" não encontrado em manual_intervention_reasons.`);

  // por segurança, não aplica em itens já tratados nem já acatados
  const items = await buildItemsQuery(sb, paymentId, scope);
  const targets = items.filter((i) => !i.manual_intervention_reason_id && i.ai_status !== "acatado");
  if (targets.length === 0) return { affected: 0, before: [], after: { reason_code: reason.code } };

  const notes = String(payload.notes ?? `Aplicado em lote via Zeev — motivo "${reason.code}".`).trim();
  const nowIso = new Date().toISOString();
  const before = targets.map((t) => ({ id: t.id, ai_status: t.ai_status }));
  const { error } = await sb
    .from("payment_items")
    .update({
      manual_intervention_reason_id: reason.id,
      manual_intervention_notes: notes,
      manual_intervention_by: actorId,
      manual_intervention_at: nowIso,
      manual_intervention_source: "zeev_bulk",
    })
    .in("id", targets.map((t) => t.id));
  if (error) throw new Error(`apply_manual_reason: ${error.message}`);
  return { affected: targets.length, before, after: { reason_id: reason.id, reason_code: reason.code, notes } };
}







// -------------------- Cadastros (Fase 2) --------------------

function digitsOnly(s: string): string {
  return (s ?? "").replace(/\D+/g, "");
}

function isValidCnpj(cnpj: string): boolean {
  const c = digitsOnly(cnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

async function userHasInternalRole(sb: SB, userId: string): Promise<boolean> {
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "diretor", "validador", "analista", "gestao_medica"]);
  return (data?.length ?? 0) > 0;
}

/** Só admin/diretor podem gravar PII sensível (CPF, data de nascimento). */
async function userCanWriteDoctorPii(sb: SB, userId: string): Promise<boolean> {
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "diretor"]);
  return (data?.length ?? 0) > 0;
}

/** Checagem genérica de papéis — espelha os gates de RLS das tabelas alvo. */
async function userHasAnyRole(sb: SB, userId: string, roles: string[]): Promise<boolean> {
  const { data } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", roles);
  return (data?.length ?? 0) > 0;
}

/**
 * Espelha public.state_scope_allows(): admin passa direto; demais só operam
 * em UFs dos hospitais/estados aos quais estão vinculados.
 */
async function callerStateScopeAllows(sb: SB, userId: string, stateUf: string | null): Promise<boolean> {
  if (!stateUf) return true;
  if (await userHasAnyRole(sb, userId, ["admin"])) return true;
  const { data, error } = await sb.rpc("user_state_ufs", { _uid: userId });
  if (error) return false;
  return Array.isArray(data) && (data as string[]).includes(stateUf);
}

/**
 * Regionalização de cadastros: o `state_uf` de médico/PJ é SEMPRE o estado do
 * hospital onde o cadastro foi feito — nunca a UF do CRM nem valor vindo do
 * payload. O trigger `enforce_state_uf_from_hospital` no banco rejeita insert
 * de service_role sem `state_uf`, então esta resolução é obrigatória.
 */
async function resolveHospitalStateUf(sb: SB, hospitalId: string | null): Promise<string> {
  if (!hospitalId) {
    throw new Error(
      "Não foi possível determinar o hospital do cadastro. Abra um lote ou selecione uma unidade ativa antes de cadastrar.",
    );
  }
  const { data, error } = await sb
    .from("hospitals")
    .select("state_uf")
    .eq("id", hospitalId)
    .maybeSingle();
  const uf = (data?.state_uf as string | null)?.trim().toUpperCase() ?? null;
  if (error || !uf) throw new Error("Hospital ativo sem UF cadastrada — corrija o cadastro do hospital.");
  return uf;
}



async function execRegisterDoctorPending(
  sb: SB,
  payload: Record<string, unknown>,
  actorId: string,
  hospitalId: string | null,
  canWritePii = false,
) {
  const full_name = String(payload.full_name ?? "").trim();
  const crm = String(payload.crm ?? "").trim();
  const crm_uf = String(payload.crm_uf ?? "").trim().toUpperCase();
  const rawCpf = payload.cpf ? digitsOnly(String(payload.cpf)) : null;
  const rawBirthDate = payload.birth_date ? String(payload.birth_date).trim() : null;
  const vinculo = payload.vinculo ? String(payload.vinculo).trim() : null;
  if (!full_name || !crm || crm_uf.length !== 2) throw new Error("full_name, crm e crm_uf (2 letras) obrigatórios.");

  // PII (CPF/nascimento) só é gravada quando o ator é admin ou diretor.
  // Para os demais papéis internos o cadastro segue sem esses campos.
  const piiOmitted = !canWritePii && Boolean(rawCpf || rawBirthDate);
  const cpf = canWritePii ? rawCpf : null;
  const birth_date = canWritePii ? rawBirthDate : null;

  // Dedup: mesmo CRM+UF já existente?
  const { data: existing } = await sb
    .from("doctors")
    .select("id, full_name")
    .eq("crm", crm)
    .eq("crm_uf", crm_uf)
    .maybeSingle();
  if (existing) {
    throw new Error(`CRM ${crm}/${crm_uf} já existe para "${existing.full_name}". Use vincular alias em vez de cadastrar de novo.`);
  }

  const insertRow: Record<string, unknown> = {
    full_name,
    crm,
    crm_uf,
    cpf,
    vinculo,
    pending_admin_review: true,
    pending_review_note: "Criado via Zeev — pendente aprovação do admin.",
    created_by: actorId,
    created_by_user_id: actorId,
    active: true,
  };
  if (birth_date) insertRow.birth_date = birth_date;
  if (hospitalId) insertRow.state_uf = crm_uf; // referência inicial

  const { data: inserted, error } = await sb
    .from("doctors")
    .insert(insertRow)
    .select("id, code, full_name, crm, crm_uf")
    .single();
  if (error) throw new Error(`register_doctor: ${error.message}`);

  return {
    affected: 1,
    before: null,
    after: inserted,
    pii_omitted: piiOmitted,
  };
}

async function execRegisterCompany(sb: SB, payload: Record<string, unknown>, actorId: string) {
  const name = String(payload.name ?? "").trim();
  const document = digitsOnly(String(payload.document ?? ""));
  const state_uf = payload.state_uf ? String(payload.state_uf).trim().toUpperCase() : null;
  if (!name) throw new Error("name obrigatório.");
  if (!isValidCnpj(document)) throw new Error("CNPJ inválido.");

  const { data: existing } = await sb
    .from("companies")
    .select("id, name")
    .eq("document", document)
    .maybeSingle();
  if (existing) throw new Error(`CNPJ já cadastrado para "${existing.name}".`);

  const { data: inserted, error } = await sb
    .from("companies")
    .insert({ name, document, state_uf, created_by: actorId })
    .select("id, code, name, document, state_uf")
    .single();
  if (error) throw new Error(`register_company: ${error.message}`);

  return { affected: 1, before: null, after: inserted };
}

async function execResolveRegistryMatch(sb: SB, payload: Record<string, unknown>, actorId: string) {
  const alias_type = String(payload.alias_type ?? "") as "convenio" | "sector" | "doctor";
  const alias_text = String(payload.alias_text ?? "").trim();
  if (!alias_text) throw new Error("alias_text obrigatório.");

  let row: Record<string, unknown>;
  let table: "doctor_aliases" | "convenio_aliases" | "sector_aliases";
  let resolved: { id: string; label: string };

  if (alias_type === "doctor") {
    const canonical_id = String(payload.canonical_id ?? "").trim();
    if (!canonical_id) throw new Error("canonical_id obrigatório para alias de médico.");
    const { data: d } = await sb.from("doctors").select("id, full_name").eq("id", canonical_id).maybeSingle();
    if (!d) throw new Error("Médico canônico não encontrado.");
    table = "doctor_aliases";
    row = { doctor_id: canonical_id, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: d.id as string, label: d.full_name as string };
  } else if (alias_type === "convenio") {
    const slug = String(payload.canonical_slug ?? "").trim();
    if (!slug) throw new Error("canonical_slug obrigatório para alias de convênio.");
    const { data: c } = await sb.from("convenios").select("slug, name").eq("slug", slug).maybeSingle();
    if (!c) throw new Error("Convênio canônico não encontrado.");
    table = "convenio_aliases";
    row = { convenio_slug: slug, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: slug, label: c.name as string };
  } else if (alias_type === "sector") {
    const slug = String(payload.canonical_slug ?? "").trim();
    if (!slug) throw new Error("canonical_slug obrigatório para alias de setor.");
    const { data: s } = await sb.from("sectors").select("slug, name").eq("slug", slug).maybeSingle();
    if (!s) throw new Error("Setor canônico não encontrado.");
    table = "sector_aliases";
    row = { sector_slug: slug, alias_text, source: "zeev", created_by: actorId };
    resolved = { id: slug, label: s.name as string };
  } else {
    throw new Error("alias_type inválido.");
  }

  const { data: inserted, error } = await sb.from(table).insert(row).select("id").single();
  if (error) throw new Error(`resolve_alias: ${error.message}`);

  return {
    affected: 1,
    before: null,
    after: { alias_id: inserted.id, alias_type, alias_text, resolved_to: resolved },
  };
}

// -------------------- Memória híbrida (Fase 4) --------------------

/** Gera assinatura estável e curta do que foi aceito, para agrupar repetições. */
function buildPreferenceScope(action: string, scope: Scope, payload: Record<string, unknown>): { scope: Record<string, unknown>; hash: string } {
  const keys: Record<string, unknown> = { action };
  // Campos relevantes do escopo (filtros)
  if (scope.convenio_slug) keys.convenio_slug = scope.convenio_slug;
  if (scope.procedure_code) keys.procedure_code = scope.procedure_code;
  if (scope.sector_missing) keys.sector_missing = true;
  if (scope.cost_center_missing) keys.cost_center_missing = true;
  if (scope.doctor_company_missing) keys.doctor_company_missing = true;
  // Campos relevantes do payload (o "valor" da preferência)
  for (const k of ["sector_code", "cost_center_code", "company_id", "alias_type", "canonical_id", "canonical_slug"]) {
    if (payload[k]) keys[k] = payload[k];
  }
  const hashSrc = Object.keys(keys).sort().map((k) => `${k}=${String(keys[k])}`).join("|");
  // hash SHA-256 → hex
  return { scope: keys, hash: hashSrc };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Após um execute aceito, grava evento + upsert do pattern. */
async function recordZeevPreference(
  sb: SB,
  hospitalId: string | null,
  action: string,
  scope: Scope,
  payload: Record<string, unknown>,
  paymentId: string | null,
) {
  if (!hospitalId) return; // sem hospital, sem memória
  const { scope: prefScope, hash: rawHash } = buildPreferenceScope(action, scope, payload);
  const scope_hash = await sha256Hex(rawHash);

  // Tenta upsert via select+update / insert
  const { data: existing } = await sb
    .from("learned_patterns")
    .select("id, occurrences")
    .eq("hospital_id", hospitalId)
    .eq("kind", "zeev_preference")
    .eq("scope_hash", scope_hash)
    .maybeSingle();

  let patternId: string;
  if (existing) {
    const newCount = (existing.occurrences ?? 0) + 1;
    const newConfidence = Math.min(1, newCount / 3); // 1→0.33, 2→0.66, 3+→1.0
    const { error } = await sb
      .from("learned_patterns")
      .update({
        occurrences: newCount,
        confidence: newConfidence,
        last_seen_at: new Date().toISOString(),
        signal: { last_payload: payload, last_scope: scope },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return;
    patternId = existing.id as string;
  } else {
    const { data: ins, error } = await sb
      .from("learned_patterns")
      .insert({
        hospital_id: hospitalId,
        kind: "zeev_preference",
        scope: prefScope,
        scope_hash,
        signal: { last_payload: payload, last_scope: scope },
        occurrences: 1,
        confidence: 0.33,
        status: "ativo",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !ins) return;
    patternId = ins.id as string;
  }

  await sb.from("learned_pattern_events").insert({
    pattern_id: patternId,
    source_kind: "zeev_executor",
    payment_id: paymentId,
    payload: { action, scope, payload },
  });
}

/** Carrega top N preferências ativas do hospital pra injetar no contexto do LLM. */
async function loadLearnedPreferences(sb: SB, hospitalId: string | null) {
  if (!hospitalId) return [];
  const { data } = await sb
    .from("learned_patterns")
    .select("scope, signal, occurrences, confidence")
    .eq("hospital_id", hospitalId)
    .eq("kind", "zeev_preference")
    .eq("status", "ativo")
    .order("occurrences", { ascending: false })
    .limit(15);
  return (data ?? []).map((p) => ({
    when: p.scope,
    suggested_payload: (p.signal as { last_payload?: unknown } | null)?.last_payload ?? null,
    seen: p.occurrences,
    confidence: p.confidence,
  }));
}

// -------------------- Knowledge base (manual inteligente) --------------------

async function loadKnowledgeArticles(sb: SB, prompt: string, currentPath: string | null): Promise<Array<{ title: string; body: string }>> {
  try {
    const { data, error } = await sb.rpc('zeev_search_knowledge', {
      p_query: prompt,
      p_route: currentPath ?? null,
      p_role: null,
      p_limit: 3,
    });
    if (error || !data) return [];
    return (data as Array<{ title: string; body: string }>).map(a => ({ title: a.title, body: a.body }));
  } catch {
    return [];
  }
}

// -------------------- Preview --------------------

async function buildPreview(sb: SB, paymentId: string, scope: Scope, action: Action): Promise<{ count: number; samples: Proposal["sample_items"] }> {
  let effectiveScope: Scope = scope;
  if (action === "accept_keep_paid" || action === "accept_keep_expected") {
    effectiveScope = {
      ...scope,
      ai_status_in: scope.ai_status_in && scope.ai_status_in.length > 0 ? scope.ai_status_in : ["reprovado", "alerta"],
    };
  } else if (action === "undo_accept") {
    effectiveScope = { ...scope, ai_status_in: ["acatado"] };
  }
  const items = await buildItemsQuery(sb, paymentId, effectiveScope);

  if (action === "link_doctor_company") {
    const missing = await filterDoctorCompanyMissing(sb, items);
    const filtered = items.filter((i) => i.doctor_id && missing.has(i.doctor_id));
    return {
      count: filtered.length,
      samples: filtered.slice(0, 3).map((i) => ({
        id: i.id,
        doctor_name: i.doctor_name,
        procedure_code: i.procedure_code,
        description: i.description,
        attendance_number: i.attendance_number,
      })),
    };
  }

  if (action === "accept_keep_paid" || action === "accept_keep_expected" || action === "apply_manual_reason") {
    const filtered = items.filter((i) => !i.manual_intervention_reason_id);
    return {
      count: filtered.length,
      samples: filtered.slice(0, 3).map((i) => ({
        id: i.id,
        doctor_name: i.doctor_name,
        procedure_code: i.procedure_code,
        description: i.description,
        attendance_number: i.attendance_number,
      })),
    };
  }

  return {
    count: items.length,
    samples: items.slice(0, 3).map((i) => ({
      id: i.id,
      doctor_name: i.doctor_name,
      procedure_code: i.procedure_code,
      description: i.description,
      attendance_number: i.attendance_number,
    })),
  };
}

// -------------------- Contexto de rota (Fase 5) --------------------

/**
 * Constrói sinais específicos da rota onde o analista está, pra dar contexto ao LLM
 * sem o cliente precisar enviar tudo. Mantém queries leves (apenas counts/top-N).
 */
async function buildRouteContext(sb: SB, path: string | null, hospitalId: string | null): Promise<Record<string, unknown> | null> {
  if (!path || !hospitalId) return null;
  const p = path.toLowerCase();

  try {
    if (p.startsWith("/pendencias")) {
      const { count: abertas } = await sb
        .from("pendencias")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .in("status", ["aberta", "em_analise"]);
      const { data: oldest } = await sb
        .from("pendencias")
        .select("id, titulo, created_at, assigned_to_user_id")
        .eq("hospital_id", hospitalId)
        .in("status", ["aberta", "em_analise"])
        .order("created_at", { ascending: true })
        .limit(3);
      return { route: "pendencias", abertas: abertas ?? 0, oldest_open: oldest ?? [] };
    }

    if (p.startsWith("/medicos")) {
      const { count: pending } = await sb
        .from("doctors")
        .select("id", { count: "exact", head: true })
        .eq("pending_admin_review", true);
      return { route: "medicos", pendentes_aprovacao: pending ?? 0 };
    }

    if (p.startsWith("/empresas")) {
      const { count: total } = await sb.from("companies").select("id", { count: "exact", head: true }).eq("active", true);
      const { count: sem_doc } = await sb.from("companies").select("id", { count: "exact", head: true }).is("document", null);
      return { route: "empresas", total_ativas: total ?? 0, sem_cnpj: sem_doc ?? 0 };
    }

    if (p.startsWith("/regras")) {
      const { count: sugestoes } = await sb
        .from("rule_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "pendente");
      return { route: "regras", sugestoes_pendentes: sugestoes ?? 0 };
    }

    if (p.startsWith("/pagamentos") && !p.match(/\/pagamentos\/[0-9a-f-]{36}/i)) {
      const { count: em_analise } = await sb
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .in("status", ["em_analise", "em_confeccao"]);
      const { count: validacao } = await sb
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "validacao");
      return { route: "pagamentos_lista", em_analise: em_analise ?? 0, em_validacao: validacao ?? 0 };
    }

    if (p.startsWith("/conversas") || p.startsWith("/comunicacao")) {
      const { count: campanhas } = await sb
        .from("comm_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "rascunho");
      return { route: "comunicacao", campanhas_rascunho: campanhas ?? 0 };
    }

    if (p.startsWith("/glosas")) {
      const { count: abertas } = await sb
        .from("glosa_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "aberta");
      return { route: "glosas", itens_abertos: abertas ?? 0 };
    }
  } catch {
    return null;
  }

  return { route: p };
}



async function callLLM(prompt: string, paymentContext: Record<string, unknown>) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

  // LGPD: mascara paciente antes de enviar; re-hidrata na resposta.
  // O prompt do analista é tratado como texto opaco (não sanitizamos —
  // se ele digitar o nome do paciente, é decisão dele).
  const { masked: maskedContext, reverseMap } = maskPatients(paymentContext);

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Contexto do pagamento atual:\n${JSON.stringify(maskedContext, null, 2)}\n\nPedido do analista:\n"${prompt}"\n\nDevolva a proposta via tool 'respond'.`,
        },
      ],
      tools: [{
        type: "function",
        function: { name: "respond", description: "Devolve a proposta estruturada", parameters: RESPOND_SCHEMA },
      }],
      tool_choice: { type: "function", function: { name: "respond" } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
    const err = new Error(`ai_gateway_${resp.status}: ${text}`);
    (err as Error & { status?: number }).status = status;
    throw err;
  }

  const data = await resp.json();
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("LLM não retornou tool call");
  try {
    const parsed = JSON.parse(toolCall.function.arguments ?? "{}");
    return unmaskDeep(parsed, reverseMap);
  } catch {
    throw new Error("falha ao parsear tool call");
  }
}

// -------------------- Aggregates --------------------

async function buildPaymentAggregates(sb: SB, paymentId: string, scopeCompanyId?: string | null) {
  let q = sb
    .from("payment_items")
    .select("id, ai_status, gross_amount, expected_amount, manual_intervention_reason_id, ai_findings, company_id, sector, cost_center_code, doctor_id, is_pool_item")
    .eq("payment_id", paymentId)
    .limit(20000);
  if (scopeCompanyId) q = q.eq("company_id", scopeCompanyId);
  const { data, error } = await q;
  if (error || !data) return null;

  let total = 0, zerados = 0, divergentes = 0, semRegra = 0, reprovados = 0, semSetor = 0, semCc = 0, semEmpresa = 0;
  let brutoTotal = 0;
  for (const it of data) {
    total++;
    const g = Number(it.gross_amount ?? 0);
    brutoTotal += g;
    if (!g || g === 0) zerados++;
    if ((it.ai_status === "reprovado" || it.ai_status === "alerta") && !it.manual_intervention_reason_id) divergentes++;
    if (it.ai_status === "reprovado") reprovados++;
    const findings = it.ai_findings as { needs_human_review?: boolean } | null;
    if (findings?.needs_human_review) semRegra++;
    if (!it.sector || it.sector === "") semSetor++;
    if (!it.cost_center_code || it.cost_center_code === "") semCc++;
    if (!it.company_id && !it.is_pool_item) semEmpresa++;
  }
  return {
    scope: scopeCompanyId ? "company" : "payment",
    total,
    zerados,
    divergentes,
    sem_regra: semRegra,
    reprovados,
    sem_setor: semSetor,
    sem_cc: semCc,
    sem_empresa: semEmpresa,
    bruto_total: Math.round(brutoTotal * 100) / 100,
  };
}

// -------------------- HTTP handler --------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    // Auth (required) — must validate BEFORE any DB access or LLM call
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: authErr } = await userClient.auth.getUser();
    const actorId: string | null = u?.user?.id ?? null;
    if (authErr || !actorId) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as RequestBody;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // payment_id opcional. Quando presente, busca contexto enriquecido.
    let pay: { id: string; hospital_id: string | null; company_name: string | null; reference: string | null } | null = null;
    let aggregates: Awaited<ReturnType<typeof buildPaymentAggregates>> = null;
    let companyGroupInfo: {
      id: string;
      company_id: string | null;
      company_name: string | null;
      items_count: number | null;
      bruto_total: number | null;
    } | null = null;
    if (body.payment_id) {
      const { data, error: payErr } = await sb
        .from("payments")
        .select("id, hospital_id, reference")
        .eq("id", body.payment_id)
        .maybeSingle();
      if (payErr) {
        return jsonResp({ error: `Falha ao carregar pagamento: ${payErr.message}` }, 500);
      }
      if (!data) return jsonResp({ error: "Pagamento não encontrado" }, 404);

      // Escopo multi-tenant: o chamador só opera sobre lotes de hospitais aos
      // quais tem vínculo. service_role/cron e papéis globais passam direto.
      if (!assertCallerHospital(_auth, (data as { hospital_id: string | null }).hospital_id ?? "")) {
        return jsonResp({ error: "hospital_scope_denied" }, 403);
      }


      // Escopo de empresa — autoritativo via company_group_id da tela quando disponível.
      let scopeCompanyId: string | null = null;
      let companyName: string | null = body.company_name ?? null;
      if (body.company_group_id) {
        const { data: grp } = await sb
          .from("payment_company_groups")
          .select("id, company_id, company_name, items_count, bruto_total")
          .eq("id", body.company_group_id)
          .eq("payment_id", body.payment_id)
          .maybeSingle();
        const g = grp as {
          id: string;
          company_id: string | null;
          company_name: string | null;
          items_count: number | null;
          bruto_total: number | null;
        } | null;
        if (g) {
          companyGroupInfo = g;
          scopeCompanyId = g.company_id;
          companyName = companyName ?? g.company_name;
        }
      }
      // Fallback: deriva nome a partir do primeiro item só se nada veio da tela.
      if (!companyName) {
        const { data: firstItem } = await sb
          .from("payment_items")
          .select("company_id")
          .eq("payment_id", body.payment_id)
          .not("company_id", "is", null)
          .limit(1)
          .maybeSingle();
        const firstCompanyId = (firstItem as { company_id?: string | null } | null)?.company_id ?? null;
        if (firstCompanyId) {
          const { data: comp } = await sb
            .from("companies")
            .select("name")
            .eq("id", firstCompanyId)
            .maybeSingle();
          companyName = (comp as { name?: string | null } | null)?.name ?? null;
        }
      }
      pay = { id: data.id, hospital_id: data.hospital_id, reference: data.reference, company_name: companyName };
      aggregates = await buildPaymentAggregates(sb, body.payment_id, scopeCompanyId);
    }


    // Hospital ativo (necessário pra memória híbrida quando não há payment_id)
    let activeHospitalId: string | null = pay?.hospital_id ?? null;
    if (!activeHospitalId) {
      const { data: ah } = await sb.from("user_active_hospital").select("hospital_id").eq("user_id", actorId).maybeSingle();
      activeHospitalId = (ah?.hospital_id as string) ?? null;
    }

    if (body.step === "propose") {
      if (!body.prompt) return jsonResp({ error: "prompt obrigatório" }, 400);

      const [learnedPrefs, routeContext, knowledgeArticles] = await Promise.all([
        loadLearnedPreferences(sb, activeHospitalId),
        buildRouteContext(sb, body.current_path ?? null, activeHospitalId),
        loadKnowledgeArticles(sb, body.prompt!, body.current_path ?? null),
      ]);

      const llm = await callLLM(body.prompt, {
        current_path: body.current_path ?? null,
        payment: pay ? { id: pay.id, reference: pay.reference, company_name: pay.company_name } : null,
        company_scope: companyGroupInfo
          ? {
              company_group_id: companyGroupInfo.id,
              company_id: companyGroupInfo.company_id,
              company_name: companyGroupInfo.company_name,
              items_count: companyGroupInfo.items_count,
              bruto_total: companyGroupInfo.bruto_total,
            }
          : null,
        aggregates: aggregates ?? null,
        has_payment_context: !!body.payment_id,
        learned_preferences: learnedPrefs,
        route_context: routeContext,
        screen_context: body.screen_context ?? null,
        knowledge_articles: knowledgeArticles.length > 0 ? knowledgeArticles : null,
      });

      // Ações sem mutação — devolve direto pro cliente aplicar.
      if (llm.action === "answer" || llm.action === "navigate" || llm.action === "unsupported" || llm.action === "clarify") {
        return jsonResp({
          step: "respond",
          action: llm.action,
          summary: llm.summary ?? "",
          payload: llm.payload ?? {},
          card: llm.action === "answer" ? (llm as { card?: unknown }).card ?? null : null,
        });
      }

      const scope: Scope = llm.scope ?? {};
      const payload: Record<string, unknown> = llm.payload ?? {};
      const REGISTRY_ACTIONS = new Set(["register_doctor_pending", "register_company", "resolve_registry_match"]);

      // Validações de payload por ação → se faltar campo, vira clarify
      if (llm.action === "set_sector" && !payload.sector_code) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual setor (código) devo aplicar?" });
      }
      if (llm.action === "set_cost_center" && !payload.cost_center_code) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual centro de custos (código P12) devo aplicar?" });
      }
      if (llm.action === "link_doctor_company" && !payload.company_id) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Em qual empresa (ID) devo vincular os médicos?" });
      }
      if (llm.action === "set_convenio" && !payload.convenio_slug && !payload.convenio_name) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual convênio devo aplicar? (slug ou nome)" });
      }
      if (llm.action === "apply_manual_reason" && !payload.reason_code && !payload.reason_id) {
        return jsonResp({ step: "respond", action: "clarify", summary: "Qual motivo de intervenção manual devo aplicar? (código)" });
      }
      if (llm.action === "register_doctor_pending") {
        const missing: string[] = [];
        if (!payload.full_name) missing.push("nome completo");
        if (!payload.crm) missing.push("CRM");
        if (!payload.crm_uf) missing.push("UF do CRM");
        if (missing.length) {
          return jsonResp({ step: "respond", action: "clarify", summary: `Pra cadastrar o médico preciso de: ${missing.join(", ")}.` });
        }
      }
      if (llm.action === "register_company") {
        const missing: string[] = [];
        if (!payload.name) missing.push("razão social");
        if (!payload.document) missing.push("CNPJ");
        if (missing.length) {
          return jsonResp({ step: "respond", action: "clarify", summary: `Pra cadastrar a empresa preciso de: ${missing.join(", ")}.` });
        }
      }
      if (llm.action === "resolve_registry_match") {
        if (!payload.alias_type || !payload.alias_text || (!payload.canonical_id && !payload.canonical_slug)) {
          return jsonResp({ step: "respond", action: "clarify", summary: "Pra registrar o alias preciso de: tipo (convenio/sector/doctor), texto alternativo e o cadastro canônico de destino." });
        }
      }

      // Ações de cadastro: NÃO precisam de payment_id e usam details em vez de sample_items.
      if (REGISTRY_ACTIONS.has(llm.action)) {
        const details: Array<{ label: string; value: string }> = [];
        if (llm.action === "register_doctor_pending") {
          details.push({ label: "Nome", value: String(payload.full_name) });
          details.push({ label: "CRM", value: `${payload.crm}/${String(payload.crm_uf).toUpperCase()}` });
          if (payload.cpf) details.push({ label: "CPF", value: digitsOnly(String(payload.cpf)) });
          if (payload.vinculo) details.push({ label: "Vínculo", value: String(payload.vinculo) });
          details.push({ label: "Status", value: "pendente aprovação admin" });
        } else if (llm.action === "register_company") {
          details.push({ label: "Razão social", value: String(payload.name) });
          details.push({ label: "CNPJ", value: digitsOnly(String(payload.document)) });
          if (payload.state_uf) details.push({ label: "UF", value: String(payload.state_uf).toUpperCase() });
        } else if (llm.action === "resolve_registry_match") {
          details.push({ label: "Tipo", value: String(payload.alias_type) });
          details.push({ label: "Texto novo", value: String(payload.alias_text) });
          details.push({ label: "Aponta para", value: String(payload.canonical_id ?? payload.canonical_slug) });
        }
        const proposal: Proposal = {
          action: llm.action,
          scope: {},
          payload,
          summary: llm.summary ?? "",
          preview_count: 1,
          sample_items: [],
          details,
        };
        return jsonResp({ step: "propose", proposal });
      }

      // Ações de mutação no lote — exigem payment_id
      if (!body.payment_id || !pay) {
        return jsonResp({
          step: "respond",
          action: "unsupported",
          summary: "Para aplicar essa ação preciso estar dentro de um pagamento específico. Abra o lote e tente de novo.",
        });
      }

      const { count, samples } = await buildPreview(sb, body.payment_id, scope, llm.action as Action);

      const proposal: Proposal = {
        action: llm.action,
        scope,
        payload,
        summary: llm.summary ?? "",
        preview_count: count,
        sample_items: samples,
      };

      return jsonResp({ step: "propose", proposal });
    }

    if (body.step === "execute") {
      if (!body.proposal) return jsonResp({ error: "proposal obrigatória" }, 400);
      const p = body.proposal;
      const REGISTRY_ACTIONS = new Set(["register_doctor_pending", "register_company", "resolve_registry_match"]);

      // Registros: gate de papel interno; não exigem payment_id
      if (REGISTRY_ACTIONS.has(p.action)) {
        const ok = await userHasInternalRole(sb, actorId);
        if (!ok) return jsonResp({ error: "Apenas papéis internos (analista+) podem cadastrar." }, 403);

        let result: { affected: number; before: unknown; after: unknown; pii_omitted?: boolean };
        if (p.action === "register_doctor_pending") {
          const canWritePii = await userCanWriteDoctorPii(sb, actorId);
          result = await execRegisterDoctorPending(sb, p.payload, actorId, pay?.hospital_id ?? null, canWritePii);
        } else if (p.action === "register_company") {
          // Espelha a RLS companies_insert_workflow: gestao_medica não cria PJ,
          // e a UF precisa estar dentro do escopo estadual do usuário.
          const canRegisterCompany = await userHasAnyRole(sb, actorId, ["admin", "diretor", "analista", "validador"]);
          if (!canRegisterCompany) {
            return jsonResp({ error: "Apenas analista, validador, diretor ou admin podem cadastrar empresa." }, 403);
          }
          const stateUf = p.payload?.state_uf ? String(p.payload.state_uf).trim().toUpperCase() : null;
          if (!(await callerStateScopeAllows(sb, actorId, stateUf))) {
            return jsonResp({ error: `Sem escopo para cadastrar empresa na UF ${stateUf}.` }, 403);
          }
          result = await execRegisterCompany(sb, p.payload, actorId);
        } else {
          result = await execResolveRegistryMatch(sb, p.payload, actorId);
        }


        const after = result.after as { id?: string };
        await sb.from("audit_log").insert({
          entity_type: p.action === "register_doctor_pending" ? "doctor"
                     : p.action === "register_company" ? "company"
                     : "alias",
          entity_id: after?.id ?? null,
          action: `zeev.${p.action}`,
          actor_id: actorId,
          hospital_id: pay?.hospital_id ?? null,
          company_name: pay?.company_name ?? null,
          diff: {
            source: "zeev_executor",
            summary: p.summary,
            payload: p.payload,
            after: result.after,
          },
        });

        await recordZeevPreference(sb, activeHospitalId, p.action, p.scope ?? {}, p.payload ?? {}, body.payment_id ?? null);

        const baseMsg = p.action === "register_doctor_pending" ? "Médico cadastrado (pendente aprovação)."
                  : p.action === "register_company" ? "Empresa cadastrada."
                  : "Alias registrado.";
        // Avisa quando CPF/nascimento foram omitidos por falta de permissão.
        const msg = result.pii_omitted
          ? `${baseMsg} CPF e/ou data de nascimento não foram salvos: apenas admin ou diretor podem registrar esses dados.`
          : baseMsg;
        return jsonResp({ step: "executed", action: p.action, affected: 1, message: msg });
      }

      // Mutações no lote
      if (!body.payment_id || !pay) return jsonResp({ error: "payment_id obrigatório para executar" }, 400);

      // Role gate: apenas papéis internos podem mutar o lote.
      const okRole = await userHasInternalRole(sb, actorId);
      if (!okRole) return jsonResp({ error: "Apenas papéis internos podem executar ações no lote." }, 403);

      // Hospital gate: caller deve ter acesso ao hospital do lote (admin/diretor bypass).
      if (pay.hospital_id) {
        const { data: adminRoles } = await sb
          .from("user_roles")
          .select("role")
          .eq("user_id", actorId)
          .in("role", ["admin", "diretor"]);
        const bypass = (adminRoles?.length ?? 0) > 0;
        if (!bypass) {
          const { data: uh } = await sb
            .from("user_hospitals")
            .select("hospital_id")
            .eq("user_id", actorId)
            .eq("hospital_id", pay.hospital_id)
            .maybeSingle();
          if (!uh) return jsonResp({ error: "Sem acesso a este hospital." }, 403);
        }
      }

      let result: { affected: number; before: unknown; after: unknown; created_link_ids?: string[] };
      if (p.action === "set_sector") {
        result = await execSetSector(sb, body.payment_id, p.scope, p.payload);
      } else if (p.action === "set_cost_center") {
        result = await execSetCostCenter(sb, body.payment_id, p.scope, p.payload);
      } else if (p.action === "link_doctor_company") {
        // Espelha a RLS dc_manage_admin_diretor: criar vínculo médico↔PJ é
        // decisão de admin/diretor — analista/validador/gestao_medica não podem.
        const canLink = await userHasAnyRole(sb, actorId, ["admin", "diretor"]);
        if (!canLink) {
          return jsonResp({ error: "Apenas diretor ou admin podem vincular médicos a uma empresa." }, 403);
        }
        result = await execLinkDoctorCompany(sb, body.payment_id, p.scope, p.payload);

      } else if (p.action === "accept_keep_paid") {
        result = await execAcceptKeepPaid(sb, body.payment_id, p.scope, p.payload, actorId);
      } else if (p.action === "accept_keep_expected") {
        result = await execAcceptKeepExpected(sb, body.payment_id, p.scope, p.payload, actorId);
      } else if (p.action === "undo_accept") {
        result = await execUndoAccept(sb, body.payment_id, p.scope, p.payload, actorId);
      } else if (p.action === "set_convenio") {
        result = await execSetConvenio(sb, body.payment_id, p.scope, p.payload);
      } else if (p.action === "apply_manual_reason") {
        result = await execApplyManualReason(sb, body.payment_id, p.scope, p.payload, actorId, pay.hospital_id);
      } else {
        return jsonResp({ error: `ação não suportada: ${p.action}` }, 400);
      }


      await sb.from("audit_log").insert({
        entity_type: "payment",
        entity_id: body.payment_id,
        action: `zeev.${p.action}`,
        actor_id: actorId,
        hospital_id: pay.hospital_id,
        company_name: pay.company_name,
        diff: {
          source: "zeev_executor",
          summary: p.summary,
          scope: p.scope,
          payload: p.payload,
          affected: result.affected,
          before: result.before,
          after: result.after,
          created_link_ids: result.created_link_ids ?? null,
        },
      });

      await recordZeevPreference(sb, activeHospitalId, p.action, p.scope ?? {}, p.payload ?? {}, body.payment_id);

      return jsonResp({
        step: "executed",
        action: p.action,
        affected: result.affected,
        message: `Aplicado em ${result.affected} ${result.affected === 1 ? "item" : "itens"}.`,
      });
    }

    return jsonResp({ error: "step inválido" }, 400);
  } catch (err) {
    const e = err as Error & { status?: number };
    return jsonResp({ error: e.message ?? String(err) }, e.status ?? 500);
  }
});
