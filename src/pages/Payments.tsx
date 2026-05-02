import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, formatCompetence, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentStatus, type PaymentType, type PaymentKind } from "@/lib/status";
import { FileUp, Search, X } from "lucide-react";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";

interface Row {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
  competence_month: string | null;
  competence_months: string[] | null;
  payment_due_date: string | null;
  payment_type: PaymentType | null;
  payment_kind: PaymentKind | null;
}

const Payments = () => {
  const { roles } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [companyFilter, setCompanyFilter] = useState<CompanyOption | null>(null);
  const [paymentIdsForCompany, setPaymentIdsForCompany] = useState<Set<string> | null>(null);
  // Busca cruzada em itens (médico, atendimento, descrição, especialidade,
  // procedimento, CC). Acionada com 3+ chars e debounced.
  const [paymentIdsForQuery, setPaymentIdsForQuery] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    document.title = "Pagamentos | MedPay Approval";
    supabase
      .from("payments")
      .select("id,reference,status,total_amount,items_count,created_at,competence_month,competence_months,payment_due_date,payment_type,payment_kind")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Row[]));
  }, []);

  // Quando uma empresa é escolhida, busca os payment_ids que possuem itens dela.
  useEffect(() => {
    let cancelled = false;
    if (!companyFilter) { setPaymentIdsForCompany(null); return; }
    supabase
      .from("payment_items")
      .select("payment_id")
      .eq("company_id", companyFilter.id)
      .then(({ data }) => {
        if (cancelled) return;
        const ids = new Set<string>((data ?? []).map((r: any) => r.payment_id).filter(Boolean));
        setPaymentIdsForCompany(ids);
      });
    return () => { cancelled = true; };
  }, [companyFilter]);

  // Busca cruzada em payment_items quando o termo for ≥3 chars.
  useEffect(() => {
    let cancelled = false;
    const term = q.trim();
    if (term.length < 3) { setPaymentIdsForQuery(null); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      const like = `%${term}%`;
      // .or() em payment_items + busca em payments (pra cobrir CC e specialties).
      const [itemsRes, paysRes] = await Promise.all([
        supabase
          .from("payment_items")
          .select("payment_id")
          .or(
            [
              `doctor_name.ilike.${like}`,
              `attendance_number.ilike.${like}`,
              `description.ilike.${like}`,
              `procedure_code.ilike.${like}`,
              `procedure_name.ilike.${like}`,
              `cost_center_code.ilike.${like}`,
              `company_name.ilike.${like}`,
            ].join(","),
          )
          .limit(2000),
        supabase
          .from("payments")
          .select("id")
          .or(`cost_center_code.ilike.${like},specialties.cs.{${term}},sectors.cs.{${term}}`)
          .limit(500),
      ]);
      if (cancelled) return;
      const ids = new Set<string>();
      (itemsRes.data ?? []).forEach((r: any) => r.payment_id && ids.add(r.payment_id));
      (paysRes.data ?? []).forEach((r: any) => r.id && ids.add(r.id));
      setPaymentIdsForQuery(ids);
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);

  const filtered = useMemo(() => rows.filter((r) => {
    const term = q.trim().toLowerCase();
    if (term) {
      const refMatches = r.reference.toLowerCase().includes(term);
      // Termo curto (<3): só filtra pela referência (busca cruzada não rodou).
      if (term.length < 3) {
        if (!refMatches) return false;
      } else {
        // Termo longo: união entre referência local e payment_ids do cruzamento.
        const crossMatches = paymentIdsForQuery?.has(r.id) ?? false;
        if (!refMatches && !crossMatches) return false;
      }
    }
    if (companyFilter) {
      if (!paymentIdsForCompany) return false;
      if (!paymentIdsForCompany.has(r.id)) return false;
    }
    return true;
  }), [rows, q, companyFilter, paymentIdsForCompany, paymentIdsForQuery]);
  const isAnalista = roles.includes("analista") || roles.includes("admin");

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Todos os lotes de pagamento e seu status no fluxo."
      />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar referência, PJ, médico, atendimento, CC, especialidade…"
              className="pl-9"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                buscando…
              </span>
            )}
          </div>
          <CompanyCombobox
            value={companyFilter}
            onChange={setCompanyFilter}
            placeholder="Filtrar por empresa (CNPJ)…"
            className="min-w-[260px]"
          />
          {companyFilter && (
            <Button variant="ghost" size="sm" onClick={() => setCompanyFilter(null)}>
              <X className="h-4 w-4 mr-1" /> Limpar
            </Button>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Nenhum pagamento encontrado.</div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((p) => (
                  <Link key={p.id} to={`/pagamentos/${p.id}`} className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{p.reference}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Competência <span className="font-medium text-foreground capitalize">{formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}</span>
                        {" · "}{p.items_count} itens · {formatCurrency(p.total_amount)}
                        {p.payment_type && ` · ${PAYMENT_TYPE_LABELS[p.payment_type]}`}
                        {p.payment_kind && ` · ${PAYMENT_KIND_LABELS[p.payment_kind]}`}
                        {" · criado em "}{formatDate(p.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Payments;