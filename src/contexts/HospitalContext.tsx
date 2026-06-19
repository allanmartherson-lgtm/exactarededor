import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { setActiveHospitalId } from "@/integrations/supabase/activeHospital";

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

  const load = useCallback(async () => {
    if (!userId) {
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
      .eq("id", userId)
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
    setActiveHospitalId(active?.id ?? null);

    // CRÍTICO (multi-tenant): grava o hospital ativo no servidor para que
    // `current_active_hospital()` no banco leia daqui — e não mais de um
    // header HTTP que o cliente controla. Sem este passo, queries operacionais
    // de usuários com +1 hospital retornam NULL e ficam bloqueadas.
    if (active) {
      const { error: setErr } = await supabase.rpc("set_active_hospital", {
        p_hospital_id: active.id,
      });
      if (setErr) console.warn("[hospital] set_active_hospital falhou:", setErr.message);
    }

    setLoading(false);
  }, [userId]);


  // Garantia extra: aplica o header sempre que o hospital ativo muda — cobre
  // reidratação após reload, restore de sessão e qualquer atualização externa
  // do state que não passe por load()/switchHospital().
  useEffect(() => {
    setActiveHospitalId(hospital?.id ?? null);
  }, [hospital?.id]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const switchHospital = useCallback(
    async (hospitalId: string) => {
      const next = availableHospitals.find((h) => h.id === hospitalId);
      if (!next || next.id === hospital?.id) return;
      const previousId = hospital?.id ?? null;
      const previousName = hospital?.name ?? null;

      // Conta pagamentos abertos na unidade atual ANTES de trocar.
      // Status considerados "em andamento" — qualquer um que não seja terminal.
      let openCount = 0;
      if (previousId) {
        const { count } = await supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", previousId)
          .in("status", [
            "em_analise_ia",
            "revisao_analista",
            "aguardando_aprovacao",
            "aprovado_parcial",
            "revisao_pos_aprovacao",
          ] as never);
        openCount = count ?? 0;
      }

      // Se houver pagamentos abertos, confirma antes de trocar.
      if (openCount > 0 && typeof window !== "undefined") {
        const ok = window.confirm(
          `Você tem ${openCount} pagamento(s) em andamento em ${previousName ?? "esta unidade"}.\n\n` +
          `Eles continuam nessa unidade — você só os verá novamente ao voltar para ela.\n\n` +
          `Deseja realmente trocar para ${next.name}?`,
        );
        if (!ok) return;
      }

      // Bloqueio temporário de ações + overlay visual
      setSwitching(true);
      try {
        setHospital(next);
        setNeedsSelection(false);
        localStorage.setItem(STORAGE_KEY, next.id);

        // CRÍTICO: trocar o header ANTES de limpar o cache. Assim, qualquer
        // refetch disparado pela invalidação já carrega o hospital novo na
        // RLS do banco — sem janela em que o cliente pode pedir dados do
        // hospital anterior.
        setActiveHospitalId(next.id);

        // Limpa cache: nenhum dado do hospital anterior pode aparecer no novo
        queryClient.clear();

        // Auditoria + persistência server-side (não bloqueia se falhar).
        // Inclui contagem de pagamentos abertos para auditoria/forense.
        await supabase
          .rpc("log_hospital_switch", {
            p_new_hospital_id: next.id,
            p_old_hospital_id: previousId,
            p_user_agent: typeof navigator !== "undefined"
              ? `${navigator.userAgent} | open_payments_left=${openCount}`
              : `open_payments_left=${openCount}`,
          })
          .then(({ error }) => {
            if (error) console.warn("[hospital-switch] log falhou:", error.message);
          });

        // Força reload completo da aplicação: garante que TODAS as telas
        // recarreguem com o novo hospital ativo — inclusive as que buscam
        // dados via RPC/fetch manual (ex.: Pagamentos), que não reagem ao
        // queryClient.clear(). Sem isso, dados da unidade anterior permanecem
        // visíveis até um refresh manual.
        window.location.reload();
      } finally {
        // Mantém o overlay visível até o reload assumir; caso o reload não
        // ocorra por algum motivo, libera o bloqueio de ações.
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
