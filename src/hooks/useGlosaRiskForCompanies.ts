import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Valor em risco" por glosa — mesma definição usada em Glosas/Créditos e Débitos:
 * soma de total_debt da view v_glosa_debts_balance (saldo derivado dos itens)
 * para as dívidas ainda ativas.
 *
 * Aqui o recorte é por PJ (company_id): recebe as PJs presentes no recorte de um
 * relatório e devolve o total em risco dessas PJs. Lista vazia = R$ 0,00 (não é erro).
 */
export function useGlosaRiskForCompanies(companyIds: string[]) {
  const ids = Array.from(new Set(companyIds.filter(Boolean))).sort();

  const { data, isLoading } = useQuery({
    queryKey: ["glosa-risk-companies", ids],
    queryFn: async () => {
      if (ids.length === 0) return 0;
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              in: (c: string, v: string[]) => Promise<{ data: { total_debt: number | null }[] | null; error: unknown }>;
            };
          };
        };
      })
        .from("v_glosa_debts_balance")
        .select("company_id,total_debt")
        .eq("status", "ativo")
        .in("company_id", ids);
      if (error) throw error;
      return (data ?? []).reduce((s, d) => s + Number(d.total_debt ?? 0), 0);
    },
    staleTime: 1000 * 60 * 5,
  });

  return { valorEmRisco: data ?? 0, isLoading };
}
