/**
 * Diálogo de criação de campanha de comunicação em massa.
 *
 * Permite ao analista/admin definir:
 * - Título e mensagem
 * - Canais (portal sempre; e-mail e/ou whatsapp opt-in)
 * - Audiência: empresas, especialidades, médicos — combinadas por AND/OR
 * - Agendamento (imediato ou data/hora futura)
 * - Permissão de resposta
 *
 * Cria registro em `comm_campaigns`. O disparo efetivo é feito pelo botão
 * "Disparar agora" da listagem (ou pelo broadcast-scheduler quando agendada).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

type Company = { id: string; name: string };
type Doctor = { id: string; full_name: string };

export function MassCampaignDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [channelPortal] = useState(true); // sempre on
  const [channelEmail, setChannelEmail] = useState(false);
  const [channelWhats, setChannelWhats] = useState(false);
  const [whatsTemplateKey, setWhatsTemplateKey] = useState("");

  const [mode, setMode] = useState<"or" | "and">("or");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialtyOptions, setSpecialtyOptions] = useState<string[]>([]);

  const [selCompanies, setSelCompanies] = useState<string[]>([]);
  const [selDoctors, setSelDoctors] = useState<string[]>([]);
  const [selSpecialties, setSelSpecialties] = useState<string[]>([]);

  const [allowReply, setAllowReply] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      // Paginação manual — PostgREST limita server-side a 1000 linhas por request,
      // ignorando `.limit()` maiores. Buscamos em páginas até esgotar.
      const fetchAll = async <T,>(
        table: "companies" | "doctors",
        select: string,
        order: string,
      ): Promise<{ rows: T[]; expected: number | null }> => {
        const PAGE = 1000;
        const out: T[] = [];
        let expected: number | null = null;
        for (let from = 0; ; from += PAGE) {
          const { data, error, count } = await supabase
            .from(table)
            .select(select, from === 0 ? { count: "exact" } : undefined)
            .eq("active", true)
            .order(order)
            .range(from, from + PAGE - 1);
          if (error || !data) break;
          if (from === 0 && typeof count === "number") expected = count;
          out.push(...(data as unknown as T[]));
          if (data.length < PAGE) break;
        }
        return { rows: out, expected };
      };

      const [c, d] = await Promise.all([
        fetchAll<Company>("companies", "id,name", "name"),
        fetchAll<Doctor & { specialties: string[] | null }>(
          "doctors",
          "id,full_name,specialties",
          "full_name",
        ),
      ]);
      // Validação: garante que a paginação trouxe o total exato do servidor.
      if (c.expected !== null && c.rows.length !== c.expected) {
        console.warn(
          `[MassCampaign] Empresas: carregadas ${c.rows.length} de ${c.expected} esperadas`,
        );
      }
      if (d.expected !== null && d.rows.length !== d.expected) {
        console.warn(
          `[MassCampaign] Médicos: carregados ${d.rows.length} de ${d.expected} esperados`,
        );
      }
      setCompanies(c.rows);
      setDoctors(d.rows.map((x) => ({ id: x.id, full_name: x.full_name })));
      const set = new Set<string>();
      d.rows.forEach((x) => (x.specialties ?? []).forEach((s) => s && set.add(s)));
      setSpecialtyOptions(Array.from(set).sort((a, b) => a.localeCompare(b)));
    })();
  }, [open]);

  // Formata "YYYY-MM" → "MM/YYYY" (padrão BR)
  const formatCompetenceBR = (ym: string | null | undefined): string => {
    if (!ym) return "";
    const m = ym.match(/^(\d{4})-(\d{2})/);
    return m ? `${m[2]}/${m[1]}` : ym;
  };




  const reset = () => {
    setTitle("");
    setMessage("");
    setChannelEmail(false);
    setChannelWhats(false);
    setWhatsTemplateKey("");
    setMode("or");
    setSelCompanies([]);
    setSelDoctors([]);
    setSelSpecialties([]);
    setAllowReply(false);
    setScheduleMode("now");
    setScheduledFor("");
  };

  const canSave =
    title.trim().length > 0 &&
    message.trim().length > 0 &&
    (selCompanies.length + selDoctors.length + selSpecialties.length > 0) &&
    (scheduleMode === "now" || !!scheduledFor) &&
    (!channelWhats || whatsTemplateKey.trim().length > 0);

  const save = async () => {
    if (!user?.id || !canSave) return;
    setSaving(true);

    const channels = ["portal"];
    if (channelEmail) channels.push("email");
    if (channelWhats) channels.push("whatsapp");

    const audience: Record<string, unknown> = {
      mode,
      companies: selCompanies,
      doctors: selDoctors,
      specialties: selSpecialties,
    };
    if (channelWhats && whatsTemplateKey.trim()) {
      audience.whatsapp_template_key = whatsTemplateKey.trim();
    }

    const status = scheduleMode === "later" ? "agendada" : "rascunho";

    const { error } = await supabase.from("comm_campaigns" as never).insert({
      title: title.trim(),
      message: message.trim(),
      channels,
      audience,
      allow_reply: allowReply,
      status,
      scheduled_for: scheduleMode === "later" ? new Date(scheduledFor).toISOString() : null,
      created_by: user.id,
    } as never);

    setSaving(false);

    if (error) {
      toast({ title: "Erro ao criar campanha", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Campanha criada",
      description:
        scheduleMode === "later"
          ? "Será disparada automaticamente no horário agendado."
          : "Use 'Disparar agora' na lista para enviar.",
    });
    reset();
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>
            Envie um comunicado para um público segmentado. Mensagens em massa são one-way;
            se permitir resposta, cada retorno abre um ticket separado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="message">Mensagem</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="Escreva o conteúdo do comunicado…"
            />
          </div>

          {/* Canais */}
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <Label className="text-[12px] uppercase tracking-wider text-muted-foreground">
              Canais de envio
            </Label>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked disabled />
                Portal (sempre)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channelEmail}
                  onCheckedChange={(v) => setChannelEmail(!!v)}
                />
                E-mail
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channelWhats}
                  onCheckedChange={(v) => setChannelWhats(!!v)}
                />
                WhatsApp
              </label>
            </div>
            {channelWhats && (
              <div className="flex flex-col gap-1 pt-2">
                <Label htmlFor="wa-tpl" className="text-[12px]">
                  Template WhatsApp (key cadastrada em whatsapp_templates)
                </Label>
                <Input
                  id="wa-tpl"
                  value={whatsTemplateKey}
                  onChange={(e) => setWhatsTemplateKey(e.target.value)}
                  placeholder="ex.: broadcast_generico_v1"
                />
                <span className="text-[11px] text-muted-foreground">
                  Twilio exige template aprovado para envios proativos. As variáveis
                  <code className="px-1">{"{{nome}}"}</code>,
                  <code className="px-1">{"{{titulo}}"}</code> e
                  <code className="px-1">{"{{mensagem}}"}</code> serão preenchidas automaticamente.
                </span>
              </div>
            )}
          </div>

          {/* Audiência */}
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Público-alvo
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Combinação</span>
                <Select value={mode} onValueChange={(v) => setMode(v as "or" | "and")}>
                  <SelectTrigger className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="or">OU (união)</SelectItem>
                    <SelectItem value="and">E (interseção)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]">Empresas</Label>
              <CompanyPicker
                companies={companies}
                selected={selCompanies}
                onChange={setSelCompanies}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]">Especialidades</Label>
              <MultiSelectChips
                values={selSpecialties}
                onChange={setSelSpecialties}
                options={specialtyOptions}
                allowCustom={false}
                emptyHint="Vazio = nenhuma especialidade selecionada"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]">Médicos específicos</Label>
              <DoctorPicker
                doctors={doctors}
                selected={selDoctors}
                onChange={setSelDoctors}
              />
            </div>
          </div>

          {/* Opções */}
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label htmlFor="allow-reply" className="text-sm">
                  Permitir resposta
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Se ligado, cada resposta abre um ticket vinculado.
                </span>
              </div>
              <Switch id="allow-reply" checked={allowReply} onCheckedChange={setAllowReply} />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Agendamento
              </Label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="sched"
                    checked={scheduleMode === "now"}
                    onChange={() => setScheduleMode("now")}
                  />
                  Disparar manualmente
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="sched"
                    checked={scheduleMode === "later"}
                    onChange={() => setScheduleMode("later")}
                  />
                  Agendar
                </label>
              </div>
              {scheduleMode === "later" && (
                <div className="flex flex-col gap-1">
                  <Input
                    type="datetime-local"
                    step={300}
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Horários em incrementos de 5 minutos.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? "Salvando…" : scheduleMode === "later" ? "Agendar campanha" : "Salvar rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Picker de empresas com busca, "selecionar todas" e import por lote (payment). */
function CompanyPicker({
  companies,
  selected,
  onChange,
}: {
  companies: Company[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const set = new Set(selected);
  const filtered = q
    ? companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : [];

  const selectAll = () => onChange(companies.map((c) => c.id));
  const clearAll = () => onChange([]);

  return (
    <div className="flex flex-col gap-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa por nome…" />

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          onClick={selectAll}
          className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
        >
          Selecionar todas ({companies.length})
        </button>
        <button
          type="button"
          onClick={() => setBatchOpen(true)}
          className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
        >
          Importar do lote…
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-destructive/10"
          >
            Limpar ({selected.length})
          </button>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="border border-border rounded-md max-h-48 overflow-y-auto">
          {filtered.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => {
                if (set.has(c.id)) onChange(selected.filter((x) => x !== c.id));
                else onChange([...selected, c.id]);
                setQ("");
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
            >
              <span>{c.name}</span>
              {set.has(c.id) && <span className="text-[10px] text-primary">selecionada</span>}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex gap-1 flex-wrap pt-1">
          {selected.map((id) => {
            const c = companies.find((x) => x.id === id);
            return (
              <button
                type="button"
                key={id}
                onClick={() => onChange(selected.filter((x) => x !== id))}
                className="text-[11px] bg-muted px-2 py-0.5 rounded hover:bg-destructive/10"
                title="Remover"
              >
                {c?.name ?? id} ×
              </button>
            );
          })}
        </div>
      )}

      <BatchCompanyPicker
        open={batchOpen}
        onOpenChange={setBatchOpen}
        companies={companies}
        onImport={(ids, replace) => {
          if (replace) onChange(ids);
          else {
            const merged = Array.from(new Set([...selected, ...ids]));
            onChange(merged);
          }
          setBatchOpen(false);
        }}
      />
    </div>
  );
}

/** Modal de seleção de empresas a partir de um lote (payment). */
function BatchCompanyPicker({
  open,
  onOpenChange,
  companies,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  onImport: (companyIds: string[], replace: boolean) => void;
}) {
  type PaymentRow = {
    id: string;
    reference: string;
    payment_type: string | null;
    competence_month: string | null;
    status: string;
  };
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [competenceFilter, setCompetenceFilter] = useState<string>("__all__");
  const [paymentId, setPaymentId] = useState<string>("");
  const [batchCompanies, setBatchCompanies] = useState<Company[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await supabase
        .from("payments")
        .select("id,reference,payment_type,competence_month,status")
        .order("created_at", { ascending: false })
        .limit(200);
      setPayments((data ?? []) as PaymentRow[]);
    })();
  }, [open]);

  useEffect(() => {
    if (!paymentId) {
      setBatchCompanies([]);
      setSelectedIds(new Set());
      return;
    }
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("payment_company_financials")
        .select("company_id")
        .eq("payment_id", paymentId)
        .limit(2000);
      const ids = Array.from(new Set((data ?? []).map((x) => (x as { company_id: string }).company_id)));
      const byId = new Map(companies.map((c) => [c.id, c]));
      const rows = ids
        .map((id) => byId.get(id))
        .filter((x): x is Company => !!x)
        .sort((a, b) => a.name.localeCompare(b.name));
      setBatchCompanies(rows);
      setSelectedIds(new Set(rows.map((r) => r.id)));
      setLoading(false);
    })();
  }, [paymentId, companies]);

  const types = Array.from(
    new Set(payments.map((p) => p.payment_type).filter((x): x is string => !!x))
  ).sort();
  const competences = Array.from(
    new Set(
      payments
        .map((p) => (p.competence_month ? p.competence_month.slice(0, 7) : null))
        .filter((x): x is string => !!x),
    ),
  ).sort((a, b) => b.localeCompare(a));
  const visible = payments.filter((p) => {
    if (typeFilter !== "__all__" && (p.payment_type ?? "") !== typeFilter) return false;
    if (competenceFilter !== "__all__") {
      const cm = p.competence_month ? p.competence_month.slice(0, 7) : "";
      if (cm !== competenceFilter) return false;
    }
    return true;
  });


  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar empresas de um lote</DialogTitle>
          <DialogDescription>
            Filtre por tipo de pagamento, escolha um lote e selecione as empresas que devem receber a campanha.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px]">Tipo de pagamento</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px]">Competência</Label>
            <Select value={competenceFilter} onValueChange={setCompetenceFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {competences.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>



          <div className="flex flex-col gap-1.5">
            <Label className="text-[12px]">Lote</Label>
            <Select value={paymentId} onValueChange={setPaymentId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um lote…" />
              </SelectTrigger>
              <SelectContent>
                {visible.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.reference}
                    {p.payment_type ? ` · ${p.payment_type}` : ""}
                    {p.competence_month ? ` · ${p.competence_month.slice(0, 7)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentId && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px]">
                  Empresas no lote ({batchCompanies.length})
                </Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
                    onClick={() => setSelectedIds(new Set(batchCompanies.map((c) => c.id)))}
                  >
                    Marcar todas
                  </button>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Desmarcar
                  </button>
                </div>
              </div>
              <div className="border border-border rounded-md max-h-72 overflow-y-auto">
                {loading && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Carregando…</div>
                )}
                {!loading && batchCompanies.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Nenhuma empresa neste lote.
                  </div>
                )}
                {!loading &&
                  batchCompanies.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggle(c.id)}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            disabled={selectedIds.size === 0}
            onClick={() => onImport(Array.from(selectedIds), false)}
          >
            Adicionar à seleção
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => onImport(Array.from(selectedIds), true)}
          >
            Substituir seleção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Picker de médicos com busca. */
function DoctorPicker({
  doctors,
  selected,
  onChange,
}: {
  doctors: Doctor[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const set = new Set(selected);
  const filtered = q
    ? doctors.filter((d) => d.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 20)
    : [];

  const selectAll = () => onChange(doctors.map((d) => d.id));
  const clearAll = () => onChange([]);

  return (
    <div className="flex flex-col gap-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar médico por nome…" />

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          onClick={selectAll}
          className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted"
        >
          Selecionar todos ({doctors.length})
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-destructive/10"
          >
            Limpar ({selected.length})
          </button>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="border border-border rounded-md max-h-48 overflow-y-auto">
          {filtered.map((d) => (
            <button
              type="button"
              key={d.id}
              onClick={() => {
                if (set.has(d.id)) onChange(selected.filter((x) => x !== d.id));
                else onChange([...selected, d.id]);
                setQ("");
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
            >
              <span>{d.full_name}</span>
              {set.has(d.id) && <span className="text-[10px] text-primary">selecionado</span>}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex gap-1 flex-wrap pt-1">
          {selected.slice(0, 100).map((id) => {
            const d = doctors.find((x) => x.id === id);
            return (
              <button
                type="button"
                key={id}
                onClick={() => onChange(selected.filter((x) => x !== id))}
                className="text-[11px] bg-muted px-2 py-0.5 rounded hover:bg-destructive/10"
                title="Remover"
              >
                {d?.full_name ?? id} ×
              </button>
            );
          })}
          {selected.length > 100 && (
            <span className="text-[11px] text-muted-foreground px-2 py-0.5">
              +{selected.length - 100} médico(s)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

