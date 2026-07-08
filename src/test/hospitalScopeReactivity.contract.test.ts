import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato de reatividade multi-tenant.
 *
 * Toda página que consulta tabelas hospital-scoped precisa:
 *  1. Importar `useActiveHospitalId` (ou `useHospital`) de `@/contexts/HospitalContext`.
 *  2. Ter pelo menos um `useEffect` cuja dependência inclua o hospital ativo
 *     (`activeHospitalId`, `hospital?.id`, `hospitalId`, `hospitalSwitching`, etc).
 *
 * Sem isso, ao trocar de unidade a tela mantém dados do hospital anterior em
 * cache local — o exato bug que motivou este teste. Se você adicionar uma
 * nova página que lê dados operacionais, inclua-a em REQUIRED_REACTIVE_PAGES.
 */

const REQUIRED_REACTIVE_PAGES = [
  // Onda 1 (payments/pendências/pools/glosas/financial)
  "Payments.tsx",
  "Pendencias.tsx",
  "Conciliacao.tsx",
  "Pools.tsx",
  "Invoices.tsx",
  "Glosas.tsx",
  "CreditosDebitos.tsx",
  "AgingRecebiveis.tsx",
  "FinancialJournal.tsx",
  "BiPagamentos.tsx",
  "Kpis.tsx",
  // Onda 2 (relatórios/saúde/comunicação)
  "DreReport.tsx",
  "ExecutiveDashboard.tsx",
  "MoneyHealth.tsx",
  "BusinessObservability.tsx",
  "PoolsReport.tsx",
  "ProcessHealth.tsx",
  "StatusAnomalies.tsx",
  "CommunicationSupervision.tsx",
  "SpecialCases.tsx",
  "CampaignApprovalQueue.tsx",
  // Já reativas antes da auditoria
  "Dashboard.tsx",
];

const HOSPITAL_HOOK_IMPORT = /from\s+["']@\/contexts\/HospitalContext["']/;
const HOSPITAL_HOOK_USAGE = /useActiveHospitalId|useHospital\b|useEnforcedHospitalId/;
const HOSPITAL_DEP_RE = /(activeHospitalId|hospitalSwitching|hospital\?\.id|hospital\.id|\bhospitalId\b|currentHospitalId|selectedHospitalId)/;

const readPage = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

/**
 * Extrai o array de dependências de cada useEffect no arquivo.
 * Só considera colchetes no NÍVEL dos argumentos do useEffect (paren depth == 1),
 * ignorando array literals do corpo do callback.
 */
function extractHookDeps(source: string, hookName: string): string[] {
  const deps: string[] = [];
  const re = new RegExp(`\\b${hookName}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let i = m.index + m[0].length;
    let parenDepth = 1;
    let braceDepth = 0;
    let bracketDepth = 0;
    let lastBracketOpen = -1;
    let lastBracketClose = -1;
    while (i < source.length && parenDepth > 0) {
      const ch = source[i];
      if (ch === "(") parenDepth++;
      else if (ch === ")") {
        parenDepth--;
        if (parenDepth === 0) break;
      } else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "[") {
        if (parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
          lastBracketOpen = i;
        }
        bracketDepth++;
      } else if (ch === "]") {
        bracketDepth--;
        if (parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
          lastBracketClose = i;
        }
      }
      i++;
    }
    if (lastBracketOpen >= 0 && lastBracketClose > lastBracketOpen) {
      deps.push(source.slice(lastBracketOpen + 1, lastBracketClose));
    }
  }
  return deps;
}

describe("Reatividade hospital-scope: páginas hub e relatórios", () => {
  for (const page of REQUIRED_REACTIVE_PAGES) {
    describe(page, () => {
      const source = readPage(page);

      it("importa hook de hospital de @/contexts/HospitalContext", () => {
        expect(source, `${page}: falta import de @/contexts/HospitalContext`).toMatch(
          HOSPITAL_HOOK_IMPORT,
        );
        expect(source, `${page}: falta uso de useActiveHospitalId/useHospital`).toMatch(
          HOSPITAL_HOOK_USAGE,
        );
      });

      it("tem pelo menos um useEffect/useCallback/useMemo com o hospital ativo nas dependências", () => {
        // Aceita reatividade via useEffect direto OU via callback/memo com dep
        // no hospital que é depois consumido por um useEffect (padrão do Dashboard).
        const effectDeps = extractHookDeps(source, "useEffect");
        const callbackDeps = extractHookDeps(source, "useCallback");
        const memoDeps = extractHookDeps(source, "useMemo");
        const all = [...effectDeps, ...callbackDeps, ...memoDeps];

        expect(
          effectDeps.length,
          `${page}: nenhum useEffect encontrado — página não recarrega ao trocar unidade`,
        ).toBeGreaterThan(0);

        const reactive = all.some((d) => HOSPITAL_DEP_RE.test(d));
        expect(
          reactive,
          `${page}: nenhum useEffect/useCallback/useMemo depende do hospital ativo — ao trocar unidade a tela mostrará dados do hospital anterior. Effect deps: ${JSON.stringify(effectDeps)}`,
        ).toBe(true);
      });
    });
  }
});
