import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetPassword from "@/pages/SetPassword";

const recoveryAuth = {
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  initialize: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};

const mainAuth = {
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/passwordRecoveryClient", () => ({
  createPasswordRecoveryClient: () => ({ auth: recoveryAuth }),
  preparePasswordRecoveryCodeVerifier: () => ({ hasCodeVerifier: false, isRecoveryVerifier: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mainAuth },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

const renderResetPage = () => {
  window.history.pushState({}, "", "/auth/reset-password?token_hash=reset-token&type=recovery");
  return render(
    <MemoryRouter initialEntries={["/auth/reset-password?token_hash=reset-token&type=recovery"]}>
      <SetPassword />
    </MemoryRouter>,
  );
};

describe("SetPassword reset flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    recoveryAuth.verifyOtp.mockResolvedValue({
      data: { session: { user: { email: "allan.martherson@icloud.com" } } },
      error: null,
    });
    recoveryAuth.updateUser.mockResolvedValue({
      data: { user: { email: "allan.martherson@icloud.com" } },
      error: null,
    });
    recoveryAuth.signOut.mockResolvedValue({ error: null });
    mainAuth.signOut.mockResolvedValue({ error: null });
    mainAuth.getSession.mockResolvedValue({ data: { session: null } });
    mainAuth.signInWithPassword.mockResolvedValue({ data: { session: { user: { email: "allan.martherson@icloud.com" } } }, error: null });
  });

  it("valida o token, salva a nova senha e confirma login imediato", async () => {
    renderResetPage();

    expect(await screen.findByRole("button", { name: /salvar nova senha/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    await waitFor(() => {
      expect(recoveryAuth.verifyOtp).toHaveBeenCalledWith({ token_hash: "reset-token", type: "recovery" });
      expect(recoveryAuth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ password: "SenhaNova#123" }));
      expect(mainAuth.signInWithPassword).toHaveBeenCalledWith({
        email: "allan.martherson@icloud.com",
        password: "SenhaNova#123",
      });
    });
  });

  it("mantém a tela pronta e mostra diagnóstico quando a validação de login falha", async () => {
    mainAuth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login credentials" } });
    renderResetPage();

    expect(await screen.findByRole("button", { name: /salvar nova senha/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar nova senha/i }));

    expect(await screen.findByText(/senha salva, mas login imediato falhou/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar nova senha/i })).toBeEnabled();
  });
});