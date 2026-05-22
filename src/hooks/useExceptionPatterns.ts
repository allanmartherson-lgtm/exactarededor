import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ExceptionPattern {
  procedure_code: string;
  company_name: string;
  count: number;
  avg_gross: number;
  avg_expected: number;
  sample_note: string;
  last_seen: string;
}

export function useExceptionPatterns(_paymentId: string): {
  patterns: ExceptionPattern[];
  loading: boolean;
} {
  const [patterns, setPatterns] = useState<ExceptionPattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("payment_items")
          .select(
            "procedure_code, company_name, gross_amount, expected_amount, exception_note, exception_marked_at, payment_id, payments!inner(created_at)"
          )
          .eq("authorized_exception", true)
          .gte("payments.created_at", since)
          .limit(2000);

        if (error) throw error;

        const map = new Map<string, ExceptionPattern>();
        for (const r of (data ?? []) as any[]) {
          const code = r.procedure_code ?? "";
          const comp = r.company_name ?? "";
          if (!code || !comp) continue;
          const key = `${code}::${comp}`;
          const gross = Number(r.gross_amount) || 0;
          const expected = Number(r.expected_amount) || 0;
          const seen = r.exception_marked_at ?? r.payments?.created_at ?? "";
          const cur = map.get(key);
          if (!cur) {
            map.set(key, {
              procedure_code: code,
              company_name: comp,
              count: 1,
              avg_gross: gross,
              avg_expected: expected,
              sample_note: r.exception_note ?? "",
              last_seen: seen,
            });
          } else {
            cur.avg_gross = (cur.avg_gross * cur.count + gross) / (cur.count + 1);
            cur.avg_expected = (cur.avg_expected * cur.count + expected) / (cur.count + 1);
            cur.count += 1;
            if (!cur.sample_note && r.exception_note) cur.sample_note = r.exception_note;
            if (seen > cur.last_seen) cur.last_seen = seen;
          }
        }

        const result = Array.from(map.values())
          .filter((p) => p.count >= 3)
          .sort((a, b) => b.count - a.count);

        if (!cancelled) setPatterns(result);
      } catch (e) {
        if (!cancelled) setPatterns([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [_paymentId]);

  return { patterns, loading };
}
