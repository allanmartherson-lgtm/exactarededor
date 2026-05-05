import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD_AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const PASSWORD_RECOVERY_STORAGE_KEY = `${PASSWORD_AUTH_STORAGE_KEY}-password-recovery`;

type PasswordRecoveryFlowType = "implicit" | "pkce";

type PasswordRecoveryClientOptions = {
  flowType?: PasswordRecoveryFlowType;
  skipAutoInitialize?: boolean;
};

export const createPasswordRecoveryClient = (options: PasswordRecoveryClientOptions = {}) => {
  const authOptions = {
    storage: localStorage,
    storageKey: PASSWORD_RECOVERY_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // PKCE coloca o token de recuperação em ?code=..., que sobrevive aos
    // redirects do preview. Hash implicit (#access_token=...) é mantido só
    // como fallback para links antigos.
    detectSessionInUrl: true,
    flowType: options.flowType ?? "pkce",
    skipAutoInitialize: options.skipAutoInitialize,
  } as Parameters<typeof createClient>[2]["auth"] & { skipAutoInitialize?: boolean };

  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: authOptions });
};

export const preparePasswordRecoveryCodeVerifier = () => {
  const recoveryKey = `${PASSWORD_RECOVERY_STORAGE_KEY}-code-verifier`;
  const defaultKey = `${PASSWORD_AUTH_STORAGE_KEY}-code-verifier`;
  const recoveryValue = localStorage.getItem(recoveryKey);
  const defaultValue = localStorage.getItem(defaultKey);

  if (!recoveryValue && defaultValue) {
    localStorage.setItem(recoveryKey, defaultValue);
  }

  const value = localStorage.getItem(recoveryKey) ?? defaultValue;
  return {
    hasCodeVerifier: Boolean(value),
    isRecoveryVerifier: value?.endsWith("/recovery") ?? false,
  };
};

export const getPasswordRecoveryVerifierState = () => {
  const value = localStorage.getItem(`${PASSWORD_RECOVERY_STORAGE_KEY}-code-verifier`)
    ?? localStorage.getItem(`${PASSWORD_AUTH_STORAGE_KEY}-code-verifier`);
  return {
    hasCodeVerifier: Boolean(value),
    isRecoveryVerifier: value?.endsWith("/recovery") ?? false,
  };
};