import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "@/pages/Auth";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

const { authMock, fromMock, signOutMock, state } = vi.hoisted(() => {
  const state = {
    authCallback: null as null | ((event: string, session: unknown) => void),
    rolesQuery: null as null | Deferred<{ data: Array<{ role: string }>; error: null }>,
    profileQuery: null as null | Deferred<{ data: { active: boolean; is_senior: boolean }; error: null }>,
  };
  const signOutMock = vi.fn().mockResolvedValue({ error: null });
  const authMock = {
    onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
      state.authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    signInWithPassword: vi.fn(),
    signOut: signOutMock,
  };
  const fromMock = vi.fn((table: string) => {
    if (table === "user_roles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => state.rolesQuery?.promise),
        })),
      };
    }
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => state.profileQuery?.promise),
          })),
        })),
      };
    }
    return { select: vi.fn() };
  });
  return { authMock, fromMock, signOutMock, state };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: authMock, from: fromMock },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: { auth: { signInWithOAuth: vi.fn() } },
}));

describe("AuthProvider login race", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authCallback = null;
    state.rolesQuery = deferred();
    state.profileQuery = deferred();
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    signOutMock.mockResolvedValue({ error: null });
  });

  it("não faz signOut por falso sem-acesso enquanto as roles ainda estão carregando", async () => {
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <AuthProvider>
          <Auth />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /^entrar$/i })).toBeInTheDocument();

    await act(async () => {
      state.authCallback?.("SIGNED_IN", {
        access_token: "header.payload.signature",
        user: { id: "user-1", email: "analista@example.com", user_metadata: {} },
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(signOutMock).not.toHaveBeenCalled();

    await act(async () => {
      state.rolesQuery?.resolve({ data: [{ role: "analista" }], error: null });
      state.profileQuery?.resolve({ data: { active: true, is_senior: false }, error: null });
    });

    await waitFor(() => {
      expect(signOutMock).not.toHaveBeenCalled();
    });
  });
});