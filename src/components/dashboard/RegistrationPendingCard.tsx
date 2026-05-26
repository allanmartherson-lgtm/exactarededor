import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface Summary {
  unregistered_doctors: number;
  unlinked_pj_pairs: number;
  affected_items: number;
  affected_amount: number;
}

export function RegistrationPendingCard() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as {
        rpc: (n: string) => Promise<{ data: Summary[] | null }>;
      }).rpc("get_registration_pending_summary");
      if (!cancelled && data && data[0]) setS(data[0]);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!s || (s.unregistered_doctors === 0 && s.unlinked_pj_pairs === 0)) return null;

  const fmtBRL = (n: number) =>
    Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <Link
      to="/medicos"
      className="flex items-center gap-3 p-4 rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 transition-colors group"
    >
      <div className="h-10 w-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Pendências de cadastro detectadas
        </p>
        <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
          {s.unregistered_doctors} médico(s) sem cadastro · {s.unlinked_pj_pairs} PJ(s) sem vínculo ·{" "}
          {s.affected_items} item(s) · {fmtBRL(Number(s.affected_amount))}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 text-amber-700 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  );
}
