import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
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
  /**
   * True quando o usuário tem +1 hospital acessível, nenhum escolhido ainda
   * (localStorage vazio e sem primary_hospital_id resolvido). Sinaliza para
   * o ProtectedRoute redirecionar à tela /selecionar-hospital.
   */
  needsSelection: boolean;
  switchHospital: (hospitalId: string) => void;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "medpay.active_hospital_id";

const HospitalContext = createContext<HospitalContextValue | undefined>(undefined);

export const HospitalProvider = ({ children }: { children: ReactNode }) => {
  const { user, hasRole, loading: authLoading } = useAuth();
  const [availableHospitals, setAvailableHospitals] = useState<Hospital[]>([]);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [primaryHospitalId, setPrimaryHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSelection, setNeedsSelection] = useState(false);

  const isGlobal = hasRole("admin") || hasRole("diretor");

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

    // Hospital principal cadastrado no perfil (default pós-login)
    const { data: profile } = await supabase
      .from("profiles")
      .select("primary_hospital_id")
      .eq("id", user.id)
      .maybeSingle();
    const primary = (profile?.primary_hospital_id as string | null) ?? null;
    setPrimaryHospitalId(primary);

    // Hospitais acessíveis (considera global role, user_hospitals e portais)
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
      // RPC retorna {id,name,uf,city,active,is_primary} — completamos com slug/cnpj
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

    // Resolução:
    //  1) localStorage (escolha explícita prévia)
    //  2) primary_hospital_id do perfil (default cadastrado pelo admin)
    //  3) único disponível → auto
    //  4) +1 disponível → null + needsSelection = true (UI redireciona p/ /selecionar-hospital)
    const stored = localStorage.getItem(STORAGE_KEY);
    let active: Hospital | null = null;
    if (stored) active = hospitals.find((h) => h.id === stored) ?? null;
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
    (hospitalId: string) => {
      const next = availableHospitals.find((h) => h.id === hospitalId);
      if (!next) return;
      setHospital(next);
      setNeedsSelection(false);
      localStorage.setItem(STORAGE_KEY, next.id);
    },
    [availableHospitals],
  );

  return (
    <HospitalContext.Provider
      value={{
        hospital,
        availableHospitals,
        primaryHospitalId,
        isGlobal,
        loading,
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
