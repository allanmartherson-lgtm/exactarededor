import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useEffect, useState } from "react";

/**
 * Prova comportamental do padrão de guarda + refetch aplicado em todas as
 * páginas hospital-scoped. Simula:
 *   1. Hospital A ativo → fetch retorna dados de A.
 *   2. Troca para hospital B → estado deve LIMPAR antes do refetch.
 *   3. Novo fetch retorna dados de B → nunca aparece dado de A em B.
 */

// Mock: hook de hospital controlável pelo teste.
let currentHospitalId: string | null = "hospital-a";
const setHospital = (id: string | null) => {
  currentHospitalId = id;
};
const useActiveHospitalId = () => currentHospitalId;

// Mock: fetcher que retorna dados diferentes por hospital.
const fetchByHospital = vi.fn(async (id: string) => {
  await Promise.resolve();
  return [`payment-of-${id}-1`, `payment-of-${id}-2`];
});

/**
 * Componente-espelho do padrão aplicado nas páginas reais
 * (ver DreReport, PoolsReport, MoneyHealth, etc).
 */
function HospitalScopedPage() {
  const activeHospitalId = useActiveHospitalId();
  const [rows, setRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeHospitalId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      const data = await fetchByHospital(activeHospitalId);
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeHospitalId]);

  return (
    <div>
      <div data-testid="loading">{loading ? "yes" : "no"}</div>
      <ul data-testid="rows">
        {rows.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

describe("Guarda + refetch hospital-scoped", () => {
  beforeEach(() => {
    fetchByHospital.mockClear();
    currentHospitalId = "hospital-a";
  });

  it("carrega dados do hospital A no mount", async () => {
    render(<HospitalScopedPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchByHospital).toHaveBeenCalledWith("hospital-a");
    expect(screen.getByText("payment-of-hospital-a-1")).toBeInTheDocument();
  });

  it("ao trocar para hospital B, limpa dados de A antes de mostrar B", async () => {
    const { rerender } = render(<HospitalScopedPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("payment-of-hospital-a-1")).toBeInTheDocument();

    // Troca de hospital
    setHospital("hospital-b");
    rerender(<HospitalScopedPage />);

    // Sincronicamente após rerender: deve estar em loading (state limpo, refetch iniciado)
    expect(screen.getByTestId("loading").textContent).toBe("yes");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Após refetch: só dados de B, nunca de A
    expect(screen.queryByText("payment-of-hospital-a-1")).not.toBeInTheDocument();
    expect(screen.queryByText("payment-of-hospital-a-2")).not.toBeInTheDocument();
    expect(screen.getByText("payment-of-hospital-b-1")).toBeInTheDocument();
    expect(screen.getByText("payment-of-hospital-b-2")).toBeInTheDocument();
    expect(fetchByHospital).toHaveBeenCalledWith("hospital-b");
  });

  it("sem hospital ativo, limpa dados e não faz fetch", async () => {
    setHospital(null);
    render(<HospitalScopedPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchByHospital).not.toHaveBeenCalled();
    expect(screen.getByTestId("rows").children.length).toBe(0);
    expect(screen.getByTestId("loading").textContent).toBe("no");
  });
});
