import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * highlightNarrative — destaca palavras-chave em prosa de IA com cores semânticas
 * inline, no estilo do mockup Apple (R$ azul, % azul, alertas vermelhos, ok verde).
 *
 * Regras (na ordem):
 *  1. Valores monetários R$ X.XXX,XX → primary (azul)
 *  2. Percentuais 12% / 12,5% → primary (azul)
 *  3. "N itens" / "N lotes" / "N empresas" → foreground tabular bold
 *  4. Palavras de risco (divergente, erro, risco, a mais, glosa, atenção) → destructive
 *  5. Palavras positivas (conciliado, aprovado, ok, regular, dentro) → success
 *  6. Palavras de atenção (pendente, analisar, verificar, revisar) → warning
 *
 * Aplica-se a um texto plano e devolve ReactNodes.
 */

// Ordem importa: monetário antes de número solto, % antes de "itens", etc.
const PATTERNS: Array<{ re: RegExp; cls: string }> = [
  // R$ 1.234,56 / R$1.234 / R$ 1,2 mi
  { re: /R\$\s?[\d.]+(?:,\d+)?(?:\s?(?:mi|mil|bi))?/gi, cls: "text-primary font-semibold tabular-nums" },
  // 12,5% ou 12%
  { re: /\b\d+(?:[.,]\d+)?\s?%/g, cls: "text-primary font-semibold tabular-nums" },
  // "23 itens", "5 lotes", "12 empresas", "3 médicos"
  { re: /\b\d+\s+(?:itens?|lotes?|empresas?|médicos?|notas?|atendimentos?)\b/gi, cls: "text-foreground font-semibold tabular-nums" },
];

const SEMANTIC_WORDS: Array<{ words: string[]; cls: string }> = [
  {
    cls: "text-destructive font-medium",
    words: ["divergente", "divergentes", "divergência", "divergências", "erro", "erros", "risco", "riscos", "a mais", "a menos", "glosa", "glosas", "crítico", "crítica", "críticos", "falha", "falhas", "bloqueio", "bloqueado", "negado"],
  },
  {
    cls: "text-success font-medium",
    words: ["conciliado", "conciliados", "conciliada", "conciliadas", "aprovado", "aprovados", "aprovada", "regular", "regulares", "ok", "dentro do esperado", "sem divergência", "sem inconsistência"],
  },
  {
    cls: "text-warning-text font-medium",
    words: ["pendente", "pendentes", "analisar", "verificar", "revisar", "atenção", "aguardando", "em análise"],
  },
];

interface Token {
  text: string;
  cls?: string;
}

function tokenize(text: string): Token[] {
  // Marcações com sentinelas; depois faz split preservando spans.
  const marks: Array<{ start: number; end: number; cls: string }> = [];

  for (const { re, cls } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      marks.push({ start: m.index, end: m.index + m[0].length, cls });
    }
  }

  for (const { words, cls } of SEMANTIC_WORDS) {
    for (const w of words) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        marks.push({ start: m.index, end: m.index + m[0].length, cls });
      }
    }
  }

  if (marks.length === 0) return [{ text }];

  // Resolve sobreposições — mantém a primeira que começou.
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered: typeof marks = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start >= cursor) {
      filtered.push(m);
      cursor = m.end;
    }
  }

  const tokens: Token[] = [];
  let pos = 0;
  for (const m of filtered) {
    if (m.start > pos) tokens.push({ text: text.slice(pos, m.start) });
    tokens.push({ text: text.slice(m.start, m.end), cls: m.cls });
    pos = m.end;
  }
  if (pos < text.length) tokens.push({ text: text.slice(pos) });
  return tokens;
}

export function HighlightNarrative({ text, className }: { text: string; className?: string }) {
  const tokens = tokenize(text);
  return (
    <span className={className}>
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={cn(t.cls)}>
            {t.text}
          </span>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </span>
  );
}
