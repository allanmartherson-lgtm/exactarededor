import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { anthropicFetch } from "../_shared/anthropicWithFallback.ts";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ContextHint {
  /** Fase D: substitui `paymentTypes`. Lista de tipos de item (Parecer, Visita, Consulta, etc.). */
  itemTypes?: { id: string; code: string; label: string }[];
  /** @deprecated — use `itemTypes`. Alias legado aceito durante a transição. */
  paymentTypes?: { id: string; code: string; label: string }[];
  specialties?: string[];
  sectors?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const { text, file, inputKind, context } = await req.json() as {
      text?: string;
      file?: { name?: string; mimeType?: string; dataBase64?: string };
      inputKind?: "table" | "free_text" | "auto";
      context?: ContextHint;
    };
    if (!text && !file) {
      return new Response(JSON.stringify({ error: "Envie texto ou arquivo" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (text && (typeof text !== "string" || text.length > 200_000)) {
      return new Response(JSON.stringify({ error: "Texto inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (file && (!file.mimeType || !file.dataBase64 || file.dataBase64.length > 20_000_000)) {
      return new Response(JSON.stringify({ error: "Arquivo inválido (máx ~15MB)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

    // -------- Heurística simples de detecção de tabela tarifária --------
    // Se inputKind="auto" e o texto parece CSV/tabela homogênea (≥5 linhas
    // com mesmo nº de colunas e ≥1 coluna numérica), tratamos como tabela.
    const detectKind = (t: string): "table" | "free_text" => {
      if (!t) return "free_text";
      const lines = t.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 60);
      if (lines.length < 5) return "free_text";
      const sep = lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : "\t";
      const widths = lines.map((l) => l.split(sep).length);
      const baseW = widths[0];
      if (baseW < 2) return "free_text";
      const homog = widths.filter((w) => w === baseW).length / widths.length;
      if (homog < 0.8) return "free_text";
      const hasNumber = lines.slice(1).some((l) =>
        l.split(sep).some((cell) => /^[\s\-R$]*\d+[\d.,]*\s*$/.test(cell)),
      );
      return hasNumber ? "table" : "free_text";
    };
    const effectiveKind: "table" | "free_text" =
      inputKind === "table" || inputKind === "free_text"
        ? inputKind
        : detectKind(text ?? "");

    const ctxLines: string[] = [];
    const itemTypes = context?.itemTypes ?? context?.paymentTypes ?? [];
    if (itemTypes.length) {
      ctxLines.push("Tipos de item disponíveis (use o `code` em `item_type_code` quando aplicável):");
      for (const pt of itemTypes.slice(0, 40)) {
        ctxLines.push(`- ${pt.code} — ${pt.label}`);
      }
    }
    if (context?.specialties?.length) {
      ctxLines.push("Especialidades cadastradas (use EXATAMENTE estes nomes em `specialties[]` quando reconhecer):");
      ctxLines.push(context.specialties.slice(0, 80).map((s) => `- ${s}`).join("\n"));
    }
    const ctxBlock = ctxLines.length ? `\n\nCONTEXTO DO HOSPITAL:\n${ctxLines.join("\n")}\n` : "";

    const userContent: any[] = [];
    const kindHint = effectiveKind === "table"
      ? `\n\n[FORMATO DETECTADO: TABELA TARIFÁRIA] — Esta entrada é uma tabela com linhas homogêneas (mesmas colunas) variando apenas dimensões como especialidade/código/setor e um valor. Gere EXATAMENTE 1 regra com N entradas em \`calculations[]\` (uma por linha de dados). NUNCA gere N regras separadas.`
      : "";
    if (text) userContent.push({ type: "text", text: `Converta este conteúdo em regras estruturadas:${kindHint}${ctxBlock}\n\n${text}` });
    if (file) {
      userContent.push({ type: "text", text: `Extraia e estruture todas as regras de validação de pagamento contidas no arquivo anexo (${file.name ?? "arquivo"}).${kindHint}${ctxBlock}` });
      const mt = String(file.mimeType ?? "");
      if (mt === "application/pdf") {
        userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.dataBase64 } });
      } else if (mt.startsWith("image/")) {
        userContent.push({ type: "image", source: { type: "base64", media_type: mt, data: file.dataBase64 } });
      } else {
        try {
          const decoded = new TextDecoder().decode(Uint8Array.from(atob(file.dataBase64!), (c) => c.charCodeAt(0)));
          userContent.push({ type: "text", text: `Conteúdo do arquivo:\n${decoded}` });
        } catch {
          return new Response(JSON.stringify({ error: `Tipo de arquivo não suportado: ${mt}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    const systemPrompt = `Você converte texto/planilhas em regras estruturadas para validação de pagamentos médicos.

# ESTRUTURA DE SAÍDA (CRÍTICA)

Cada regra TEM uma natureza ("informativo" | "calculavel"). Quando "calculavel", a regra é um CONTAINER com um array \`calculations[]\` — cada cálculo é uma linha tarifária (1 valor, opcionalmente filtrada por especialidade, código, setor, função, etc.). UMA regra pode ter de 1 a N cálculos.

# QUANDO CONSOLIDAR EM UMA REGRA COM VÁRIOS CÁLCULOS (vs. múltiplas regras)

CONSOLIDE em 1 regra com N \`calculations[]\` quando:
- A entrada é uma TABELA TARIFÁRIA (linhas homogêneas variando 1-2 dimensões + valor).
- Várias linhas compartilham o mesmo contexto contratual (mesmo hospital, mesmo tipo de pagamento, mesmo escopo) e diferem apenas em valor por especialidade/código/função/etc.
- O documento descreve "tabela de honorários" / "tabela de consultas" / "valores por especialidade".

SEPARE em regras distintas quando:
- Cada bloco descreve um contrato/acordo independente (PJ diferente, vigência diferente, severidade diferente).
- Cláusulas têm naturezas opostas (uma de pacote, outra de exclusão, outra informativa).

# EXEMPLO (TABELA DE CONSULTAS)

Entrada:
\`\`\`
Hospital,Especialidade,Valor
DF Star,Cardiologia,130
DF Star,Endocrinologia,130
DF Star,Geriatria,150
DF Star,Anestesiologia,95
\`\`\`

Saída CORRETA — UMA regra:
{
  "rules": [{
    "name": "Tabela de Consultas — DF Star",
    "description": "Valores fixos por especialidade para consultas ambulatoriais",
    "rule_text": "Pagar valor fixo conforme tabela de consultas vigente, distinto por especialidade",
    "severity": "aviso",
    "scope": "master",
    "sectors": ["consulta"],
    "item_type_code": "consulta",
    "calculations": [
      { "label": "Cardiologia",      "calculation_type": "valor_fixo", "fixed_amount": 130, "specialties": ["Cardiologia"] },
      { "label": "Endocrinologia",   "calculation_type": "valor_fixo", "fixed_amount": 130, "specialties": ["Endocrinologia"] },
      { "label": "Geriatria",        "calculation_type": "valor_fixo", "fixed_amount": 150, "specialties": ["Geriatria"] },
      { "label": "Anestesiologia",   "calculation_type": "valor_fixo", "fixed_amount": 95,  "specialties": ["Anestesiologia"] }
    ]
  }]
}

Saída ERRADA: 4 regras separadas, cada uma com 1 valor.

# REGRAS GERAIS DE EXTRAÇÃO

1. Cada bloco rotulado como "Regra N:", "Cláusula N:" = 1 regra. Subitens (1), 2), 3)) dentro do mesmo bloco ficam no \`rule_text\`, não viram regras separadas.
2. IGNORE cabeçalhos/rodapés (página, código de proposta, assinatura, "Confidencial"), campos vazios, e duplicatas (mesma regra repetida em páginas).
3. NÃO parafraseie ao ponto de mudar o sentido; não invente cláusulas.

# CAMPOS POR REGRA

- name, description, rule_text (em pt-BR).
- severity: 'info' | 'aviso' | 'bloqueio'.
- scope: 'master' (vale para todos) | 'especifica' (vinculada a um médico/empresa).
- sectors: ['cirurgia'|'hemodinamica'|'parecer'|'visita'|'procedimento'|'consulta'|'outro'].
- item_type_code: código de item_type quando reconhecido (ex.: "parecer", "visita", "consulta" — ver CONTEXTO).
- target_type/target_identifier/target_name: só preencher se scope='especifica'.
- calculations[]: array (pode ser vazio se a regra for puramente informativa).

# CAMPOS POR CÁLCULO (calculations[])

- label: rótulo curto do cálculo (ex.: "Cardiologia", "Pacote Vascular").
- calculation_type: 'valor_fixo'|'pacote'|'tabela_diferenciada'|'bonus'|'complemento'|'percentual_sobre_convenio'|'exclusao'|'informativo'.
- fixed_amount, package_amount, bonus_amount, bonus_pct, target_amount, multiplier, deflator_pct, convenio_percentage: numéricos ou null conforme o tipo.
- procedure_codes: códigos TUSS quando o cálculo se aplica só a procedimentos específicos.
- specialties: nomes de especialidade quando o cálculo se aplica só a uma especialidade (use os nomes do CONTEXTO).
- sectors: setores quando o cálculo é restrito a um setor.
- doctor_roles: ['cirurgiao_principal'|'primeiro_aux'|'segundo_aux'|'anestesista'|'instrumentador'] quando aplicável.
- item_type_code: código do item_type quando o cálculo é restrito a um tipo de item (Parecer × Visita, etc.).

Se não houver cálculos (regra puramente informativa, ex.: "É vedado o pagamento de..."), retorne calculations como array vazio.`;

    const aiResp = await anthropicFetch({
      model: "claude-sonnet-4-5",
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      tools: [{
        name: "extract_rules",
        description: "Extrai regras estruturadas (uma regra pode conter vários cálculos)",
        input_schema: {
          type: "object",
          properties: {
            rules: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  rule_text: { type: "string" },
                  severity: { type: "string", enum: ["info", "aviso", "bloqueio"] },
                  scope: { type: "string", enum: ["master", "especifica"] },
                  sectors: { type: "array", items: { type: "string", enum: ["cirurgia", "hemodinamica", "parecer", "visita", "procedimento", "consulta", "outro"] } },
                  item_type_code: { type: ["string", "null"] },
                  target_type: { type: ["string", "null"], enum: ["medico", "empresa", null] },
                  target_identifier: { type: ["string", "null"] },
                  target_name: { type: ["string", "null"] },
                  calculations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: ["string", "null"] },
                        calculation_type: { type: "string", enum: ["valor_fixo", "pacote", "tabela_diferenciada", "bonus", "complemento", "percentual_sobre_convenio", "exclusao", "informativo"] },
                        fixed_amount: { type: ["number", "null"] },
                        package_amount: { type: ["number", "null"] },
                        bonus_amount: { type: ["number", "null"] },
                        bonus_pct: { type: ["number", "null"] },
                        target_amount: { type: ["number", "null"] },
                        multiplier: { type: ["number", "null"] },
                        deflator_pct: { type: ["number", "null"] },
                        convenio_percentage: { type: ["number", "null"] },
                        procedure_codes: { type: "array", items: { type: "string" } },
                        specialties: { type: "array", items: { type: "string" } },
                        sectors: { type: "array", items: { type: "string" } },
                        doctor_roles: { type: "array", items: { type: "string" } },
                        item_type_code: { type: ["string", "null"] },
                      },
                      required: ["calculation_type"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "rule_text", "severity", "scope", "sectors", "calculations"],
                additionalProperties: false,
              },
            },
          },
          required: ["rules"],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: "tool", name: "extract_rules" },
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de uso da IA atingido. Tente novamente em instantes.", code: "RATE_LIMIT" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados.", code: "CREDITS_EXHAUSTED" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `Falha na IA (${aiResp.status})`, code: "AI_ERROR" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await aiResp.json();
    const tc = data.content?.find((b: any) => b.type === "tool_use");
    if (!tc) throw new Error("No tool call");
    const parsed = tc.input;

    // Dedup defensivo (mesma assinatura: nome + texto + nº de cálculos)
    if (parsed?.rules && Array.isArray(parsed.rules)) {
      const seen = new Set<string>();
      parsed.rules = parsed.rules.filter((r: any) => {
        const sig = `${(r?.name ?? "").toLowerCase()}|${(r?.rule_text ?? "").toLowerCase().replace(/\s+/g, " ").trim()}|${(r?.calculations?.length ?? 0)}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });

      // Fase D: normaliza item_type_code ↔ payment_type_code (legado).
      // Preferimos `item_type_code`; espelhamos em `payment_type_code` para
      // consumidores que ainda leem o nome antigo.
      const mirrorTypeCode = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        const it = obj.item_type_code ?? null;
        const pt = obj.payment_type_code ?? null;
        const chosen = it ?? pt ?? null;
        obj.item_type_code = chosen;
        obj.payment_type_code = chosen;
      };
      for (const r of parsed.rules) {
        mirrorTypeCode(r);
        if (Array.isArray(r?.calculations)) r.calculations.forEach(mirrorTypeCode);
      }
    }

    return new Response(JSON.stringify({ ...parsed, detected_kind: effectiveKind }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
