/**
 * Pre-build auditor for the sidebar navigation.
 *
 * Verifies that the flattened NAV_ITEMS (used by the sidebar) match
 * EXPECTED_SIDEBAR_ORDER exactly — same labels, same icons, same order, same count.
 *
 * Usage:
 *   bun run audit:nav
 *
 * Wire into pre-build by running it before `vite build` in your CI / release flow.
 * Exits with code 1 on any mismatch so CI can fail the build.
 */
import { NAV_ITEMS, EXPECTED_SIDEBAR_ORDER, flattenNav } from "../src/config/navItems";

type Issue = { kind: "count" | "label" | "icon" | "order"; index?: number; message: string };

function audit(): Issue[] {
  const issues: Issue[] = [];
  const flat = flattenNav(NAV_ITEMS);

  if (flat.length !== EXPECTED_SIDEBAR_ORDER.length) {
    issues.push({
      kind: "count",
      message: `Esperado ${EXPECTED_SIDEBAR_ORDER.length} itens, encontrado ${flat.length}.`,
    });
  }

  const max = Math.max(flat.length, EXPECTED_SIDEBAR_ORDER.length);
  for (let i = 0; i < max; i++) {
    const expected = EXPECTED_SIDEBAR_ORDER[i];
    const actual = flat[i];

    if (!expected) {
      issues.push({
        kind: "order",
        index: i,
        message: `Item extra na posição ${i + 1}: "${actual?.label}".`,
      });
      continue;
    }
    if (!actual) {
      issues.push({
        kind: "order",
        index: i,
        message: `Item faltando na posição ${i + 1}: esperado "${expected.label}".`,
      });
      continue;
    }

    if (actual.label !== expected.label) {
      issues.push({
        kind: "label",
        index: i,
        message: `Posição ${i + 1}: label "${actual.label}" ≠ esperado "${expected.label}".`,
      });
    }
    if (actual.iconName !== expected.iconName) {
      issues.push({
        kind: "icon",
        index: i,
        message: `Posição ${i + 1} ("${expected.label}"): icon "${actual.iconName}" ≠ esperado "${expected.iconName}".`,
      });
    }
  }

  return issues;
}

function main() {
  const issues = audit();

  console.log("\n🔍 Auditoria do NAV_ITEMS (sidebar)\n");
  console.log("Ordem esperada:");
  EXPECTED_SIDEBAR_ORDER.forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(2, " ")}. ${e.label.padEnd(24, " ")} ${e.iconName}`);
  });

  console.log("\nOrdem atual (flatten do NAV_ITEMS):");
  flattenNav(NAV_ITEMS).forEach((it, i) => {
    console.log(`  ${String(i + 1).padStart(2, " ")}. ${it.label.padEnd(24, " ")} ${it.iconName}  (${it.to})`);
  });

  if (issues.length === 0) {
    console.log("\n✅ NAV_ITEMS bate exatamente com a ordem esperada (label + icon).\n");
    process.exit(0);
  }

  console.error(`\n❌ ${issues.length} divergência(s) encontrada(s):`);
  for (const issue of issues) {
    console.error(`  • [${issue.kind}] ${issue.message}`);
  }
  console.error("");
  process.exit(1);
}

main();