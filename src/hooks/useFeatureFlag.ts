import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook que checa se uma feature flag está habilitada para o usuário atual.
 * Usa a função `is_feature_enabled(_key, _user_id)` no banco, que respeita
 * roles permitidas e rollout percentual determinístico.
 */
export function useFeatureFlag(key: string): { enabled: boolean; loading: boolean } {
  const { user } = useAuth();
  const [state, setState] = useState({ enabled: false, loading: true });
  useEffect(() => {
    if (!user?.id) { setState({ enabled: false, loading: false }); return; }
    let mounted = true;
    (async () => {
      const { data } = await supabase.rpc("is_feature_enabled" as never, {
        _key: key,
        _user_id: user.id,
      } as never);
      if (mounted) setState({ enabled: Boolean(data), loading: false });
    })();
    return () => { mounted = false; };
  }, [key, user?.id]);
  return state;
}
