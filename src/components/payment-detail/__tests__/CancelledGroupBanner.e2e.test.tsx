import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CancelledGroupBanner } from "../CancelledGroupBanner";

/**
 * E2E do banner "Pagamento cancelado".
 *
 * Garante o contrato visível para o usuário:
 *   1. Banner aparece quando group.cancelled_at != null.
 *   2. Clicar em "Reativar pagamento" chama o RPC reactivate_cancelled_group.
 *   3. Quando o RPC retorna sucesso e o callback onReactivated re-busca o
 *      grupo com cancelled_at = null, o banner SOME imediatamente — sem
 *      depender de F5 ou de Realtime.
 *
 * Esse fluxo já quebrou três vezes em produção; o teste é a apólice.
 */

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Harness que simula o pai (CompanyAnalysis): mantém o `group` em estado
// e, no onReactivated, "recarrega" o grupo com cancelled_at = null —
// exatamente como o load() real faz após o RPC zerar as marcas.
function Harness({ initialCancelled = true }: { initialCancelled?: boolean }) {
  const [group, setGroup] = useState<{
    id: string;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    cancellation_source: string | null;
  }>({
    id: "grp-1",
    cancelled_at: initialCancelled ? "2026-06-08T12:00:00Z" : null,
    cancellation_reason: "divergencia_conciliacao",
    cancellation_source: "reconciliacao",
  });

  return (
    <CancelledGroupBanner
      group={group}
      canReactivate
      onReactivated={async () => {
        // Simula o reload do pai depois do RPC: a fonte da verdade agora
        // tem cancelled_at = null, então o banner deve sumir.
        setGroup((g) => ({ ...g, cancelled_at: null }));
      }}
    />
  );
}

describe("CancelledGroupBanner — E2E reativação sem refresh", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("mostra o banner quando o grupo está cancelado", () => {
    render(<Harness />);
    expect(screen.getByTestId("cancelled-group-banner")).toBeInTheDocument();
    expect(screen.getByText(/Pagamento cancelado/i)).toBeInTheDocument();
    expect(screen.getByTestId("reactivate-cancelled-group")).toBeEnabled();
  });

  it("clicar em 'Reativar pagamento' chama o RPC com o id do grupo", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("reactivate-cancelled-group"));

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("reactivate_cancelled_group", {
      p_group_id: "grp-1",
    });
  });

  it("o banner some IMEDIATAMENTE após reativação bem-sucedida (sem refresh)", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId("cancelled-group-banner")).toBeInTheDocument();
    await user.click(screen.getByTestId("reactivate-cancelled-group"));

    // O banner precisa sumir como consequência do re-render reativo,
    // sem nenhuma navegação ou refresh adicional.
    expect(screen.queryByTestId("cancelled-group-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reactivate-cancelled-group")).not.toBeInTheDocument();
  });

  it("se o RPC falhar, o banner PERMANECE e o botão volta a ficar clicável", async () => {
    rpcMock.mockResolvedValue({ error: { message: "boom" } });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("reactivate-cancelled-group"));

    expect(screen.getByTestId("cancelled-group-banner")).toBeInTheDocument();
    expect(screen.getByTestId("reactivate-cancelled-group")).toBeEnabled();
  });

  it("usuário sem permissão vê mensagem de restrição em vez do botão", () => {
    render(
      <CancelledGroupBanner
        group={{
          id: "grp-2",
          cancelled_at: "2026-06-08T12:00:00Z",
          cancellation_reason: "manual",
          cancellation_source: "manual",
        }}
        canReactivate={false}
        onReactivated={async () => {}}
      />,
    );
    expect(screen.queryByTestId("reactivate-cancelled-group")).not.toBeInTheDocument();
    expect(screen.getByText(/Reativação restrita/i)).toBeInTheDocument();
  });
});
