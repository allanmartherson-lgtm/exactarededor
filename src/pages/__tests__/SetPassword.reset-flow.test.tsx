import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Auth from "@/pages/Auth";
import SetPassword from "@/pages/SetPassword";

const { recoveryAuth, mainAuth, createPasswordRecoveryClientMock } = vi.hoisted(() => {
  const recoveryAuth = {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    exchangeCodeForSession: vi.fn(),
    verifyOtp: vi.fn(),
    setSession: vi.fn(),
    initialize: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  };
  const mainAuth = {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  };
  return {
    recoveryAuth,
    mainAuth,
    createPasswordRecoveryClientMock: vi.fn(() => ({ auth: recoveryAuth })),
  };
});

vi.mock("@/lib/passwordRecoveryClient", () => ({
  createPasswordRecoveryClient: createPasswordRecoveryClientMock,
  preparePasswordRecoveryCodeVerifier: () => ({ hasCodeVerifier: false, isRecoveryVerifier: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mainAuth },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: { auth: { signInWithOAuth: vi.fn() } },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    roles: [],
    rolesLoading: false,
    accountActive: true,
    signIn: vi.fn(),
  }),
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

const renderResetPageWithCachedToken = () => {
  sessionStorage.setItem("exacta-password-auth-url", JSON.stringify({
    href: "http://localhost:3000/auth/reset-password?token_hash=reset-token&type=recovery",
    savedAt: Date.now(),
  }));
  window.history.pushState({}, "", "/auth/reset-password");
  return render(
    <MemoryRouter initialEntries={["/auth/reset-password"]}>
      <SetPassword />
    </MemoryRouter>,
  );
};

/**
 * O botão primário do formulário passou a ser `<CuraSubmitButton>`, que renderiza
 * o web component `<cura-button>` do design system CURA mais um `<button
 * type="submit">` oculto (`aria-hidden`) só para disparar o submit nativo.
 *
 * Como o custom element não é registrado no ambiente de teste, não existe shadow
 * DOM e portanto nenhum `role="button"` — por isso consultamos pelo texto do
 * próprio `cura-button`. Clicar nele aciona `form.requestSubmit()`, que é o
 * mesmo caminho do usuário real.
 */
const submitButton = () =>
  screen.getByText(/salvar nova senha/i, { selector: "cura-button" });
const findSubmitButton = () =>
  screen.findByText(/salvar nova senha/i, { selector: "cura-button" });
const querySubmitButton = () =>
  screen.queryByText(/salvar nova senha/i, { selector: "cura-button" });

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
    recoveryAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  });

  it("solicita link de recuperação pela tela de login", async () => {
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "allan.martherson@icloud.com" } });
    fireEvent.click(screen.getByRole("button", { name: /esqueci minha senha/i }));

    await waitFor(() => {
      expect(createPasswordRecoveryClientMock).toHaveBeenCalledWith({ flowType: "implicit" });
      expect(recoveryAuth.resetPasswordForEmail).toHaveBeenCalledWith(
        "allan.martherson@icloud.com",
        { redirectTo: "http://localhost:3000/auth/reset-password" },
      );
    });
  });

  it("solicita reset com fluxo implicit para o link funcionar sem depender de code_verifier local", async () => {
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "allan.martherson@icloud.com" } });
    fireEvent.click(screen.getByRole("button", { name: /esqueci minha senha/i }));

    await waitFor(() => {
      expect(recoveryAuth.resetPasswordForEmail).toHaveBeenCalledWith(
        "allan.martherson@icloud.com",
        { redirectTo: "http://localhost:3000/auth/reset-password" },
      );
    });
  });

  it("valida o token, salva a nova senha e confirma login imediato", async () => {
    renderResetPage();

    expect(await findSubmitButton()).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.click(submitButton());

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

    expect(await findSubmitButton()).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "SenhaNova#123" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText(/senha salva, mas login imediato falhou/i)).toBeInTheDocument();
    // `toBeEnabled` só vale para elementos de formulário; no custom element o
    // que importa é não ter ficado travado em `disabled` após a falha.
    expect(submitButton()).not.toHaveAttribute("disabled");
  });

  it("usa o token salvo no cache quando a URL já foi limpa no boot", async () => {
    renderResetPageWithCachedToken();

    expect(await findSubmitButton()).toBeInTheDocument();
    expect(recoveryAuth.verifyOtp).toHaveBeenCalledWith({ token_hash: "reset-token", type: "recovery" });
  });

  it("mostra mensagem clara de link inválido/expirado quando verifyOtp falha", async () => {
    recoveryAuth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: "Token has expired or is invalid", status: 401 },
    });

    renderResetPage();

    await waitFor(() => {
      expect(recoveryAuth.verifyOtp).toHaveBeenCalledWith({
        token_hash: "reset-token",
        type: "recovery",
      });
    });

    // O fallback do SetPassword aguarda ~1.5s antes de marcar como inválido
    const matches = await screen.findAllByText(
      /não foi possível validar o link|link inválido ou expirado/i,
      {},
      { timeout: 3000 },
    );
    expect(matches.length).toBeGreaterThan(0);


    expect(querySubmitButton()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /voltar ao login/i })).toBeInTheDocument();
    expect(recoveryAuth.updateUser).not.toHaveBeenCalled();
    expect(mainAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

