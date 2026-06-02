import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Hospital {
  id: string;
  slug: string;
  name: string;
  state_uf: string;
  cnpj: string | null;
  active: boolean;
}

interface HospitalContextValue {
  hospital: Hospital | null;
  availableHospitals: Hospital[];
  primaryHospitalId: string | null;
  isGlobal: boolean;
  loading: boolean;
  /** true durante a janela de troca: bloqueia ações e mostra overlay */
  switching: boolean;
  /** true quando o usuário tem +1 hospital acessível e nenhum escolhido ainda */
  needsSelection: boolean;
  switchHospital: (hospitalId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "medpay.active_hospital_id";

const HospitalContext = createContext<HospitalContextValue | undefined>(undefined);

export const HospitalProvider = ({ children }: { children: ReactNode }) => {
  const { user, hasRole, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [availableHospitals, setAvailableHospitals] = useState<Hospital[]>([]);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [primaryHospitalId, setPrimaryHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [needsSelection, setNeedsSelection] = useState(false);

  const isGlobal = hasRole("admin") || hasRole("diretor");
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!user) {
      setHospital(null);
      setAvailableHospitals([]);
      setPrimaryHospitalId(null);
      setNeedsSelection(false);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Perfil: hospital principal (default) + último ativo (persistência server-side)
    const { data: profile } = await supabase
      .from("profiles")
      .select("primary_hospital_id, last_active_hospital_id")
      .eq("id", user.id)
      .maybeSingle();
    const primary = (profile?.primary_hospital_id as string | null) ?? null;
    const lastActive = ((profile as Record<string, unknown> | null)?.last_active_hospital_id as string | null) ?? null;
    setPrimaryHospitalId(primary);

    // Hospitais acessíveis (RLS-aware)
    const { data, error } = await supabase.rpc("my_accessible_hospitals");
    let hospitals: Hospital[] = [];
    if (error || !data) {
      const { data: fallback } = await supabase
        .from("hospitals")
        .select("*")
        .eq("active", true)
        .order("name");
      hospitals = (fallback ?? []) as Hospital[];
    } else {
      const ids = (data as Array<{ id: string }>).map((h) => h.id);
      if (ids.length) {
        const { data: full } = await supabase
          .from("hospitals")
          .select("*")
          .in("id", ids)
          .eq("active", true)
          .order("name");
        hospitals = (full ?? []) as Hospital[];
      }
    }
    setAvailableHospitals(hospitals);

    // Ordem de resolução do hospital ativo:
    //  1) localStorage (sessão atual)
    //  2) last_active_hospital_id (persistência server-side, atravessa devices)
    //  3) primary_hospital_id (default cadastrado pelo admin)
    //  4) único disponível → auto
    //  5) +1 → exige seleção explícita (/selecionar-hospital)
    const stored = localStorage.getItem(STORAGE_KEY);
    let active: Hospital | null = null;
    if (stored) active = hospitals.find((h) => h.id === stored) ?? null;
    if (!active && lastActive) active = hospitals.find((h) => h.id === lastActive) ?? null;
    if (!active && primary) active = hospitals.find((h) => h.id === primary) ?? null;
    if (!active && hospitals.length === 1) active = hospitals[0];

    setHospital(active);
    setNeedsSelection(!active && hospitals.length > 1);
    if (active) localStorage.setItem(STORAGE_KEY, active.id);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const switchHospital = useCallback(
    async (hospitalId: string) => {
      const next = availableHospitals.find((h) => h.id === hospitalId);
      if (!next || next.id === hospital?.id) return;
      const previousId = hospital?.id ?? null;

      // Bloqueio temporário de ações + overlay visual
      setSwitching(true);
      try {
        setHospital(next);
        setNeedsSelection(false);
        localStorage.setItem(STORAGE_KEY, next.id);

        // Limpa cache: nenhum dado do hospital anterior pode aparecer no novo
        queryClient.clear();

        // Auditoria + persistência server-side (não bloqueia se falhar)
        await supabase
          .rpc("log_hospital_switch", {
            p_new_hospital_id: next.id,
            p_old_hospital_id: previousId,
            p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          })
          .then(({ error }) => {
            if (error) console.warn("[hospital-switch] log falhou:", error.message);
          });

        // Pequena janela para o usuário perceber o feedback e os componentes refazerem queries
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        setSwitching(false);
      }
    },
    [availableHospitals, hospital, queryClient],
  );

  return (
    <HospitalContext.Provider
      value={{
        hospital,
        availableHospitals,
        primaryHospitalId,
        isGlobal,
        loading,
        switching,
        needsSelection,
        switchHospital,
        refresh: load,
      }}
    >
      {children}
    </HospitalContext.Provider>
  );
};

export const useHospital = () => {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error("useHospital must be used within HospitalProvider");
  return ctx;
};

export const useActiveHospitalId = (): string | null => {
  const { hospital } = useHospital();
  return hospital?.id ?? null;
};

/**
 * Guard programático para queries: garante que nenhuma query manual rode
 * sem hospital ativo. Use no início de hooks/data fetchers operacionais:
 *
 *   const hospitalId = useEnforcedHospitalId();
 *   useQuery({ enabled: !!hospitalId, queryKey: [..., hospitalId], ... });
 */
export const useEnforcedHospitalId = (): string | null => {
  const { hospital, switching } = useHospital();
  if (switching) return null; // suspende queries durante a troca
  return hospital?.id ?? null;
};
