import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato entre o TimeMode da UI e o motor de regras.
 *
 * O bug histórico foi: novos presets (ex.: "feriado") entravam no enum da UI
 * mas o motor não tinha branch dedicado, caindo silenciosamente em
 * "qualquer dia". Este teste força que todo valor do enum apareça
 * explicitamente no motor E que o serializer converta para colunas de banco
 * que o motor sabe interpretar.
 */

const EDITOR_PATH = resolve(__dirname, "../../components/rules/RuleCalculationsEditor.tsx");
const ENGINE_PATH = resolve(__dirname, "../../../supabase/functions/_shared/rulesEngine.ts");

function extractTimeModeUnion(src: string): string[] {
  const m = src.match(/export type TimeMode\s*=\s*([^;]+);/);
  if (!m) throw new Error("TimeMode não encontrado no editor");
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

describe("TimeMode contract (UI ↔ motor de regras)", () => {
  const editorSrc = readFileSync(EDITOR_PATH, "utf8");
  const engineSrc = readFileSync(ENGINE_PATH, "utf8");
  const modes = extractTimeModeUnion(editorSrc);

  it("enum não está vazio e inclui 'qualquer'", () => {
    expect(modes.length).toBeGreaterThan(1);
    expect(modes).toContain("qualquer");
  });

  it.each(modes.filter((m) => m !== "qualquer"))(
    "motor tem branch explícito para time_mode='%s'",
    (mode) => {
      // Aceita comparação literal `=== "mode"` ou `tm === "mode"` em qualquer ordem.
      const pattern = new RegExp(`["']${mode}["']`);
      expect(engineSrc).toMatch(pattern);
    },
  );

  it("serializer trata cada preset (weekdays/includes_holidays)", () => {
    for (const mode of modes) {
      if (mode === "qualquer" || mode === "personalizado") continue;
      const pattern = new RegExp(`time_mode\\s*===\\s*["']${mode}["']`);
      expect(editorSrc).toMatch(pattern);
    }
  });
});
