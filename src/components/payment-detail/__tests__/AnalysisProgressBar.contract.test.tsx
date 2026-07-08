import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * Contrato do AnalysisProgressBar:
 *
 *  1. Quando o job carregado do banco tem status != "em_andamento" (concluido,
 *     parcial, cancelado), o componente NUNCA deve renderizar nada. Se ele
 *     renderizar o card mesmo com job concluído, o banner "Analisando…" fica
 *     visível eternamente — foi exatamente esse o bug reportado pelo usuário.
 *
 *  2. O efeito de subscribe/poll deve depender APENAS de `paymentId`. Se ele
 *     depender de `job.status`, o realtime é reconstruído a cada UPDATE e uma
 *     transição "em_andamento → concluido" pode ser perdida na janela entre
 *     unsubscribe e resubscribe.
 */

// Mock supabase client — permite injetar o job a ser "retornado" pelo load()
const jobFixture: {
  current: null | {
    id: string;
    payment_id: string;
    status: string;
    total_companies: number;
    processed_companies: number;
    failed_companies: unknown[];
    company_list: string[];
    total_items: number | null;
    started_at: string;
    finished_at: string | null;
  };
} = { current: null };

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (result: unknown) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      then: (resolve: any) => resolve(result),
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "payment_processing_jobs") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: jobFixture.current, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "payment_company_groups") {
          return makeQuery({ count: 0, error: null });
        }
        if (table === "payments") {
          return makeQuery({ data: { items_count: null }, error: null });
        }
        return makeQuery({ data: null, error: null });
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
      }),
      removeChannel: () => {},
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/confirm", () => ({ confirmDialog: async () => false }));

import { AnalysisProgressBar } from "../AnalysisProgressBar";

describe("AnalysisProgressBar — contrato de estado terminal", () => {
  beforeEach(() => {
    jobFixture.current = null;
  });

  it("não renderiza nada quando job.status === 'concluido'", async () => {
    jobFixture.current = {
      id: "j1",
      payment_id: "p1",
      status: "concluido",
      total_companies: 5,
      processed_companies: 5,
      failed_companies: [],
      company_list: [],
      total_items: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
    const { container } = render(<AnalysisProgressBar paymentId="p1" />);
    // aguarda um tick para o load() assíncrono resolver
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("não renderiza nada quando job.status === 'parcial' ou 'cancelado'", async () => {
    for (const status of ["parcial", "cancelado"]) {
      jobFixture.current = {
        id: "j1",
        payment_id: "p1",
        status,
        total_companies: 5,
        processed_companies: 5,
        failed_companies: [],
        company_list: [],
        total_items: null,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      };
      const { container, unmount } = render(<AnalysisProgressBar paymentId="p1" />);
      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
      unmount();
    }
  });

  it("não renderiza nada quando não existe job para o pagamento", async () => {
    jobFixture.current = null;
    const { container } = render(<AnalysisProgressBar paymentId="p1" />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});

describe("AnalysisProgressBar — contrato do efeito de subscribe", () => {
  it("useEffect depende APENAS de paymentId (regressão: não incluir job.status)", async () => {
    // Lê o próprio código-fonte do componente e verifica a lista de deps.
    // Se alguém adicionar `job.status` ou `job` ao array, este teste quebra.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AnalysisProgressBar.tsx"),
      "utf8",
    );
    // Procura pelo array de deps do useEffect principal (o que chama load()).
    // Ele deve ser exatamente `[paymentId]` — nada mais.
    const match = src.match(/\}, \[([^\]]*)\]\);\s*\n\s*if \(!job\) return null;/);
    expect(match, "não encontrei o array de deps do useEffect antes de `if (!job)`").toBeTruthy();
    const deps = match![1].split(",").map((s) => s.trim()).filter(Boolean);
    expect(deps).toEqual(["paymentId"]);
  });
});
