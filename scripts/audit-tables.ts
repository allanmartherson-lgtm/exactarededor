#!/usr/bin/env bun
/**
 * Audita todas as páginas/componentes que usam <table> e verifica se as
 * cabeçalhos (<th>) e células (<td>) seguem o padrão visual do design system.
 *
 * Como o estilo base é aplicado globalmente em src/index.css (table thead th,
 * table tbody td) com !important nas propriedades críticas, qualquer arquivo
 * que use <table>...<thead>/<tbody>... já herda o padrão.
 *
 * Esta checagem verifica:
 *   1. Lista todos os arquivos .tsx que renderizam <table>.
 *   2. Para cada um, conta <th> e <td> e detecta possíveis violações:
 *        - uppercase manual em <td>            (proibido em conteúdo de célula)
 *        - h-12 / py-4 / py-6 em <th> ou <td>  (height excessivo)
 *        - hover:bg-... em <tr>                (overrides do hover global)
 *        - bg-card / bg-muted em <thead>       (override do thead global)
 *   3. Sugere a aplicação dos helpers cell-nowrap / cell-num / cell-status /
 *      cell-date / cell-mono em colunas reconhecíveis (P12, CNPJ, datas,
 *      números, badges) que ainda não os usem.
 *
 * Saída:  texto colorido no terminal + exit code 0 (ok) ou 1 (violações).
 *
 * Uso:    bun run scripts/audit-tables.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

type Issue = { line: number; rule: string; snippet: string; severity: "error" | "warn" | "info" };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
      walk(p, out);
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const RULES: Array<{
  name: string;
  severity: Issue["severity"];
  test: (line: string) => boolean;
  message: string;
}> = [
  {
    name: "td-uppercase",
    severity: "error",
    test: (l) => /<td[^>]*\bclassName="[^"]*\buppercase\b/.test(l),
    message: "<td> com 'uppercase' — conteúdo de célula deve ser Title Case",
  },
  {
    name: "th-h-12",
    severity: "warn",
    test: (l) => /<th[^>]*\bclassName="[^"]*\bh-12\b/.test(l),
    message: "<th> com 'h-12' — altura é controlada pelo padding global (10px 16px)",
  },
  {
    name: "td-py-heavy",
    severity: "warn",
    test: (l) => /<td[^>]*\bclassName="[^"]*\bpy-(4|5|6|8)\b/.test(l),
    message: "<td> com padding vertical excessivo (py-4+) — quebra o cap de 52px",
  },
  {
    name: "tr-hover-override",
    severity: "warn",
    test: (l) => /<tr[^>]*\bclassName="[^"]*hover:bg-(?!muted\b)/.test(l),
    message: "<tr> com hover:bg-* customizado — usa o hover global (--table-row-hover)",
  },
  {
    name: "thead-bg-override",
    severity: "info",
    test: (l) => /<thead[^>]*\bclassName="[^"]*bg-(card|background)\b/.test(l),
    message: "<thead> com background sólido — design system usa transparente",
  },
];

const SUGGESTIONS: Array<{
  match: RegExp;
  helper: string;
  reason: string;
}> = [
  { match: /<th[^>]*>\s*P12\s*<\/th>/i, helper: "cell-mono", reason: "coluna P12 (código)" },
  { match: /<th[^>]*>\s*CNPJ\s*<\/th>/i, helper: "cell-mono", reason: "coluna CNPJ" },
  { match: /<th[^>]*>\s*Status\s*<\/th>/i, helper: "cell-status", reason: "coluna Status" },
  { match: /<th[^>]*>\s*(Quando|Data|Criado em|Atualizado em|Pgto)\s*<\/th>/i, helper: "cell-date", reason: "coluna de data" },
  { match: /<th[^>]*\btext-right[^>]*>\s*(Valor|Repasse|Total|Linhas|Quantidade|Qtd)/i, helper: "cell-num", reason: "coluna numérica" },
];

function audit(file: string) {
  const src = readFileSync(file, "utf8");
  if (!/<table[\s>]/.test(src)) return null;

  const lines = src.split("\n");
  const issues: Issue[] = [];
  const suggestions: { rule: string; reason: string }[] = [];

  let thCount = 0;
  let tdCount = 0;
  let tableCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/<table[\s>]/.test(line)) tableCount++;
    if (/<th[\s>]/.test(line)) thCount++;
    if (/<td[\s>]/.test(line)) tdCount++;
    for (const r of RULES) {
      if (r.test(line)) {
        issues.push({
          line: i + 1,
          rule: r.name,
          snippet: line.trim().slice(0, 120),
          severity: r.severity,
        });
      }
    }
  }

  for (const s of SUGGESTIONS) {
    if (s.match.test(src) && !new RegExp(`className="[^"]*\\b${s.helper}\\b`).test(src)) {
      suggestions.push({ rule: s.helper, reason: s.reason });
    }
  }

  return { file, tableCount, thCount, tdCount, issues, suggestions };
}

function main() {
  const files = walk(SRC);
  const reports = files.map(audit).filter(Boolean) as NonNullable<ReturnType<typeof audit>>[];

  console.log(`${C.bold}${C.cyan}🔍 Auditoria de tabelas${C.reset}\n`);
  console.log(`${C.dim}Encontrados ${reports.length} arquivo(s) com <table>.${C.reset}\n`);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const r of reports) {
    const rel = relative(ROOT, r.file);
    const errs = r.issues.filter((i) => i.severity === "error").length;
    const warns = r.issues.filter((i) => i.severity === "warn").length;
    const infos = r.issues.filter((i) => i.severity === "info").length;
    totalErrors += errs;
    totalWarnings += warns;

    const status =
      errs > 0 ? `${C.red}✖ ${errs} erro(s)${C.reset}` :
      warns > 0 ? `${C.yellow}⚠ ${warns} aviso(s)${C.reset}` :
      `${C.green}✓ conforme${C.reset}`;

    console.log(`${C.bold}${rel}${C.reset}  ${C.gray}(${r.tableCount} table, ${r.thCount} th, ${r.tdCount} td)${C.reset}  ${status}`);

    for (const issue of r.issues) {
      const tag =
        issue.severity === "error" ? `${C.red}ERR${C.reset}` :
        issue.severity === "warn" ? `${C.yellow}WARN${C.reset}` :
        `${C.cyan}INFO${C.reset}`;
      console.log(`  ${C.gray}L${issue.line}${C.reset} [${tag}] ${issue.rule}`);
      console.log(`    ${C.dim}${issue.snippet}${C.reset}`);
    }
    for (const s of r.suggestions) {
      console.log(`  ${C.cyan}HINT${C.reset} aplicar .${C.bold}${s.rule}${C.reset} → ${s.reason}`);
    }
    if (infos > 0 || r.issues.length > 0 || r.suggestions.length > 0) console.log();
  }

  console.log(`${C.bold}Resumo:${C.reset}`);
  console.log(`  arquivos com tabelas: ${reports.length}`);
  console.log(`  erros: ${totalErrors === 0 ? C.green : C.red}${totalErrors}${C.reset}`);
  console.log(`  avisos: ${totalWarnings === 0 ? C.green : C.yellow}${totalWarnings}${C.reset}`);

  if (totalErrors > 0) {
    console.log(`\n${C.red}✖ Auditoria falhou.${C.reset}`);
    process.exit(1);
  }
  console.log(`\n${C.green}✓ Todas as tabelas estão conformes ao design system.${C.reset}`);
}

main();