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
import { FileUp, Search, X, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatCNPJ, onlyDigits } from "@/lib/cnpj";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  items_count: number;
  created_at: string;
  competence_month: string | null;
  payment_due_date: string | null;
  payment_type: PaymentType | null;
  payment_kind: PaymentKind | null;
}

interface Company { id: string; name: string; document: string | null; }

const Payments = () => {
  const { roles } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState<Company | null>(null);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [paymentIdsForCompany, setPaymentIdsForCompany] = useState<Set<string> | null>(null);

  useEffect(() => {
    document.title = "Pagamentos | MedPay Approval";
    supabase
      .from("payments")
      .select("id,reference,status,total_amount,items_count,created_at,competence_month,payment_due_date,payment_type,payment_kind")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Row[]));
    supabase.from("companies").select("id,name,document").order("name")
      .then(({ data }) => setCompanies((data ?? []) as Company[]));
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

  const filtered = useMemo(() => rows.filter((r) => {
    if (q && !r.reference.toLowerCase().includes(q.toLowerCase())) return false;
    if (companyFilter) {
      if (!paymentIdsForCompany) return false;
      if (!paymentIdsForCompany.has(r.id)) return false;
    }
    return true;
  }), [rows, q, companyFilter, paymentIdsForCompany]);
  const isAnalista = roles.includes("analista") || roles.includes("admin");

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Todos os lotes de pagamento e seu status no fluxo."
        actions={
          isAnalista && (
            <Button asChild>
              <Link to="/pagamentos/novo"><FileUp className="h-4 w-4 mr-2" /> Nova base</Link>
            </Button>
          )
        }
      />
      <div className="p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por referência..." className="pl-9" />
          </div>
          <Popover open={companyPickerOpen} onOpenChange={setCompanyPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className={cn("min-w-[260px] justify-between font-normal", !companyFilter && "text-muted-foreground")}>
                {companyFilter
                  ? `${companyFilter.name}${companyFilter.document ? ` · ${formatCNPJ(companyFilter.document)}` : ""}`
                  : "Filtrar por empresa (CNPJ)…"}
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0" align="start">
              <Command
                filter={(value, search) => {
                  const v = value.toLowerCase();
                  const s = search.toLowerCase();
                  if (v.includes(s)) return 1;
                  // permite buscar por dígitos do CNPJ
                  const digits = onlyDigits(search);
                  if (digits && v.includes(digits)) return 1;
                  return 0;
                }}
              >
                <CommandInput placeholder="Buscar por nome ou CNPJ…" />
                <CommandList>
                  <CommandEmpty>Nenhuma empresa encontrada.</CommandEmpty>
                  <CommandGroup>
                    {companies.map((c) => {
                      const checked = companyFilter?.id === c.id;
                      const docMasked = c.document ? formatCNPJ(c.document) : "—";
                      return (
                        <CommandItem
                          key={c.id}
                          value={`${c.name} ${c.document ?? ""} ${onlyDigits(c.document ?? "")}`}
                          onSelect={() => { setCompanyFilter(c); setCompanyPickerOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                          <div className="flex flex-col">
                            <span>{c.name}</span>
                            <span className="text-xs text-muted-foreground">CNPJ {docMasked}</span>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
                        Competência <span className="font-medium text-foreground capitalize">{formatCompetence(p.competence_month)}</span>
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