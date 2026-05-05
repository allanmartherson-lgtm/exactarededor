import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD_AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

export const createPasswordRecoveryClient = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: PASSWORD_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

export const getPasswordRecoveryVerifierState = () => {
  const value = localStorage.getItem(`${PASSWORD_AUTH_STORAGE_KEY}-code-verifier`);
  return {
    hasCodeVerifier: Boolean(value),
    isRecoveryVerifier: value?.endsWith("/recovery") ?? false,
  };
};