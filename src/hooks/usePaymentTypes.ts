import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PaymentTypeRow = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  active: boolean;
};

export function usePaymentTypes(opts: { onlyActive?: boolean } = { onlyActive: true }) {
  const [list, setList] = useState<PaymentTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("payment_types").select("*").order("sort_order").order("label");
    if (opts.onlyActive) q = q.eq("active", true);
    const { data } = await q;
    setList((data ?? []) as PaymentTypeRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [opts.onlyActive]);

  return { list, loading, reload: load };
}
