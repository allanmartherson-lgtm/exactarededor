import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD_AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const PASSWORD_RECOVERY_STORAGE_KEY = `${PASSWORD_AUTH_STORAGE_KEY}-password-recovery`;

export const createPasswordRecoveryClient = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: PASSWORD_RECOVERY_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // Deixa a auth-js processar #access_token=... e ?code=... automaticamente
    // e disparar PASSWORD_RECOVERY/SIGNED_IN no listener.
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

export const getPasswordRecoveryVerifierState = () => {
  const value = localStorage.getItem(`${PASSWORD_RECOVERY_STORAGE_KEY}-code-verifier`)
    ?? localStorage.getItem(`${PASSWORD_AUTH_STORAGE_KEY}-code-verifier`);
  return {
    hasCodeVerifier: Boolean(value),
    isRecoveryVerifier: value?.endsWith("/recovery") ?? false,
  };
};