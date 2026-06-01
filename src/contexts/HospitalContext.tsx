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
  isGlobal: boolean;
  loading: boolean;
  switchHospital: (hospitalId: string) => void;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "medpay.active_hospital_id";

const HospitalContext = createContext<HospitalContextValue | undefined>(undefined);

export const HospitalProvider = ({ children }: { children: ReactNode }) => {
  const { user, hasRole, loading: authLoading } = useAuth();
  const [availableHospitals, setAvailableHospitals] = useState<Hospital[]>([]);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);

  const isGlobal = hasRole("admin") || hasRole("diretor");

  const load = useCallback(async () => {
    if (!user) {
      setHospital(null);
      setAvailableHospitals([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    // Admin/diretor enxergam todos. Demais, apenas os vinculados.
    let hospitals: Hospital[] = [];
    if (isGlobal) {
      const { data } = await supabase
        .from("hospitals")
        .select("*")
        .eq("active", true)
        .order("name");
      hospitals = (data ?? []) as Hospital[];
    } else {
      const { data } = await supabase
        .from("user_hospitals")
        .select("hospital:hospitals(*)")
        .eq("user_id", user.id);
      hospitals = ((data ?? []) as Array<{ hospital: Hospital | null }>)
        .map((r) => r.hospital)
        .filter((h): h is Hospital => h !== null && h.active);
      // dedupe (mesmo hospital pode aparecer com roles diferentes)
      const seen = new Set<string>();
      hospitals = hospitals.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
    }

    setAvailableHospitals(hospitals);

    // Resolve hospital ativo: localStorage → primeiro disponível
    const stored = localStorage.getItem(STORAGE_KEY);
    const active =
      hospitals.find((h) => h.id === stored) ??
      hospitals.find((h) => h.slug === "df_star") ??
      hospitals[0] ??
      null;
    setHospital(active);
    if (active) localStorage.setItem(STORAGE_KEY, active.id);
    setLoading(false);
  }, [user, isGlobal]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const switchHospital = useCallback(
    (hospitalId: string) => {
      const next = availableHospitals.find((h) => h.id === hospitalId);
      if (!next) return;
      setHospital(next);
      localStorage.setItem(STORAGE_KEY, next.id);
    },
    [availableHospitals],
  );

  return (
    <HospitalContext.Provider
      value={{ hospital, availableHospitals, isGlobal, loading, switchHospital, refresh: load }}
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

/** Helper para inserts: retorna o id do hospital ativo ou lança erro claro. */
export const useActiveHospitalId = (): string | null => {
  const { hospital } = useHospital();
  return hospital?.id ?? null;
};
