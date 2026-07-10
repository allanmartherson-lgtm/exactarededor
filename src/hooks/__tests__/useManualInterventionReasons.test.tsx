import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Motivos de tratamento manual são conceitualmente globais (hospital_id = NULL).
 * Este teste garante que:
 * 1. O hook devolve os mesmos motivos independentemente do hospital ativo.
 * 2. Motivos com sufixo `_legado` NÃO aparecem no dropdown (só existem para
 *    preservar histórico migrado).
 * 3. Um novo motivo global cadastrado em qualquer unidade aparece automaticamente.
 */

type Row = {
  id: string;
  code: string;
  label: string;
  category: "reclassificacao_clinica" | "aceite_financeiro";
  description: string | null;
  is_seed: boolean;
  is_active: boolean;
  sort_order: number;
  hospital_id: string | null;
};

const GLOBAL_ROWS: Row[] = [
  {
    id: "1",
    code: "acatar_risco",
    label: "Acatar divergência (aceito o risco)",
    category: "aceite_financeiro",
    description: null,
    is_seed: true,
    is_active: true,
    sort_order: 10,
    hospital_id: null,
  },
  {
    id: "2",
    code: "valor_negociado",
    label: "Valor negociado fora da regra",
    category: "aceite_financeiro",
    description: null,
    is_seed: true,
    is_active: true,
    sort_order: 20,
    hospital_id: null,
  },
  {
    id: "3",
    code: "tuss_ambiguo",
    label: "Procedimento com TUSS ambíguo",
    category: "reclassificacao_clinica",
    description: null,
    is_seed: true,
    is_active: true,
    sort_order: 10,
    hospital_id: null,
  },
  {
    id: "4",
    code: "acatar_divergencia_legado",
    label: "Acatar divergência (legado)",
    category: "aceite_financeiro",
    description: null,
    is_seed: true,
    is_active: true,
    sort_order: 99,
    hospital_id: null,
  },
  {
    id: "5",
    code: "reclassificacao_legado",
    label: "Reclassificação clínica (legado)",
    category: "reclassificacao_clinica",
    description: null,
    is_seed: true,
    is_active: true,
    sort_order: 99,
    hospital_id: null,
  },
];

let mockRows: Row[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const buildQuery = () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        Promise.resolve({ data: mockRows.filter((r) => r.is_active), error: null }).then(resolve),
    };
    return query;
  };
  return {
    supabase: {
      from: () => buildQuery(),
    },
  };
});

import { useManualInterventionReasons } from "@/hooks/useManualInterventionReasons";

describe("useManualInterventionReasons", () => {
  beforeEach(() => {
    mockRows = [...GLOBAL_ROWS];
  });

  it("filtra motivos com sufixo _legado do dropdown", async () => {
    const { result } = renderHook(() => useManualInterventionReasons());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const codes = result.current.reasons.map((r) => r.code);
    expect(codes).toEqual(
      expect.arrayContaining(["acatar_risco", "valor_negociado", "tuss_ambiguo"]),
    );
    expect(codes).not.toContain("acatar_divergencia_legado");
    expect(codes).not.toContain("reclassificacao_legado");
    expect(result.current.reasons).toHaveLength(3);
  });

  it("devolve os mesmos motivos independentemente do hospital ativo (dados globais)", async () => {
    // Como a query não filtra por hospital, todos os hospitais recebem a mesma lista.
    // Simula duas "renderizações" (ex.: usuário troca de unidade) e compara resultado.
    const a = renderHook(() => useManualInterventionReasons());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    const codesUnidadeA = a.result.current.reasons.map((r) => r.code).sort();

    const b = renderHook(() => useManualInterventionReasons());
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    const codesUnidadeB = b.result.current.reasons.map((r) => r.code).sort();

    expect(codesUnidadeA).toEqual(codesUnidadeB);
    // E todos os motivos exibidos são globais (hospital_id = null).
    expect(a.result.current.reasons.every((r) => r.hospital_id === null)).toBe(true);
  });

  it("um novo motivo global cadastrado aparece automaticamente para todas as unidades", async () => {
    mockRows = [
      ...GLOBAL_ROWS,
      {
        id: "6",
        code: "motivo_novo_global",
        label: "Novo motivo global",
        category: "aceite_financeiro",
        description: null,
        is_seed: false,
        is_active: true,
        sort_order: 30,
        hospital_id: null,
      },
    ];

    const { result } = renderHook(() => useManualInterventionReasons());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.reasons.map((r) => r.code)).toContain("motivo_novo_global");
  });

  it("agrupa motivos por categoria mantendo o filtro de legado", async () => {
    const { result } = renderHook(() => useManualInterventionReasons());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const financeiroCodes = result.current.byCategory.aceite_financeiro.map((r) => r.code);
    const clinicaCodes = result.current.byCategory.reclassificacao_clinica.map((r) => r.code);

    expect(financeiroCodes).toContain("acatar_risco");
    expect(financeiroCodes).toContain("valor_negociado");
    expect(financeiroCodes).not.toContain("acatar_divergencia_legado");

    expect(clinicaCodes).toContain("tuss_ambiguo");
    expect(clinicaCodes).not.toContain("reclassificacao_legado");
  });
});
