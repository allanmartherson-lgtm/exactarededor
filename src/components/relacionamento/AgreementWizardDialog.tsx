// Wizard de Cadastro de Acordos (6 etapas) — grava em agreement_registrations.
// Cada avanço persiste como rascunho, permitindo sair e continuar depois.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";
import { useHospital } from "@/contexts/HospitalContext";
import { useRequireHospital } from "@/hooks/useRequireHospital";
import { formatCNPJ } from "@/lib/cnpj";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import type { AgreementRegistration, ExtraItem } from "@/lib/agreementRegistrations";
import { PAYMENT_TABLE_BASE_LABEL } from "@/lib/agreementRegistrations";

interface CompanyOption {
  id: string;
  name: string;
  document: string | null;
  active: boolean;
}
interface ConvenioOption {
  // convenios não tem uuid: a chave do cadastro é o slug
  slug: string;
  name: string;
}
interface DoctorOption {
  id: string;
  full_name: string;
  crm: string | null;
  crm_uf: string | null;
}
interface HospitalOption {
  id: string;
  name: string;
}


const STEPS = [
  "Identificação",
  "Abrangência",
  "Tabela de pagamento",
  "Regras especiais",
  "Itens extras",
  "Observações",
] as const;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const numOrNull = (v: string): number | null => {
  const t = v.replace(",", ".").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: AgreementRegistration | null;
  onSaved: () => void;
}

export function AgreementWizardDialog({ open, onOpenChange, record, onSaved }: Props) {
  const { hospital } = useHospital();
  const { hospitalId, ensure } = useRequireHospital();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState<string | null>(null);

  // Etapa 1
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  // Replicação regional: hospitais adicionais que recebem o mesmo acordo
  const [replicaHospitalIds, setReplicaHospitalIds] = useState<string[]>([]);
  const [hospitalsOpen, setHospitalsOpen] = useState(false);
  const [hospitalOptions, setHospitalOptions] = useState<HospitalOption[]>([]);
  const [lockedHospitalIds, setLockedHospitalIds] = useState<string[]>([]);

  // Etapa 2
  const [allConvenios, setAllConvenios] = useState(true);
  const [convenioExceptions, setConvenioExceptions] = useState<string[]>([]);
  const [allDoctors, setAllDoctors] = useState(true);
  const [doctorExceptions, setDoctorExceptions] = useState<string[]>([]);
  const [includesAuxiliary, setIncludesAuxiliary] = useState(false);
  const [includesAccessRoute, setIncludesAccessRoute] = useState(false);
  // Etapa 3
  const [paymentTableBase, setPaymentTableBase] = useState<string>("");
  const [paymentPercentage, setPaymentPercentage] = useState("");
  const [hasGlosa, setHasGlosa] = useState(false);
  const [glosaConditions, setGlosaConditions] = useState("");
  // Etapa 4
  const [urgencyDiff, setUrgencyDiff] = useState(false);
  const [urgencyPct, setUrgencyPct] = useState("");
  const [weekendAdd, setWeekendAdd] = useState(false);
  const [weekendPct, setWeekendPct] = useState("");
  const [hasFixedValues, setHasFixedValues] = useState(false);
  const [fixedUrgencyDiff, setFixedUrgencyDiff] = useState(false);
  const [exclusionsNotes, setExclusionsNotes] = useState("");
  // Etapa 5/6
  const [extraItems, setExtraItems] = useState<ExtraItem[]>([]);
  const [freeNotes, setFreeNotes] = useState("");

  // Cadastros
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [convenios, setConvenios] = useState<ConvenioOption[]>([]);
  // Somente os médicos vinculados à clínica selecionada (doctor_companies).
  // Carregar o cadastro inteiro estourava o statement timeout do banco.
  const [linkedDoctors, setLinkedDoctors] = useState<DoctorOption[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [registriesLoading, setRegistriesLoading] = useState(false);

  // Reidrata o formulário sempre que abre (novo ou continuação de rascunho)
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setId(record?.id ?? null);
    setCompanyId(record?.company_id ?? null);
    setEffectiveFrom(record?.effective_from ?? "");
    setEffectiveTo(record?.effective_to ?? "");
    setAllConvenios(record?.applies_to_all_convenios ?? true);
    setConvenioExceptions(record?.convenio_exceptions ?? []);
    setAllDoctors(record?.applies_to_all_doctors ?? true);
    setDoctorExceptions(record?.doctor_exceptions ?? []);
    setIncludesAuxiliary(record?.includes_auxiliary ?? false);
    setIncludesAccessRoute(record?.includes_access_route ?? false);
    setPaymentTableBase(record?.payment_table_base ?? "");
    setPaymentPercentage(record?.payment_percentage != null ? String(record.payment_percentage) : "");
    setHasGlosa(record?.has_glosa ?? false);
    setGlosaConditions(record?.glosa_conditions ?? "");
    setUrgencyDiff(record?.urgency_differentiation ?? false);
    setUrgencyPct(record?.urgency_addition_pct != null ? String(record.urgency_addition_pct) : "");
    setWeekendAdd(record?.weekend_holiday_addition ?? false);
    setWeekendPct(
      record?.weekend_holiday_addition_pct != null ? String(record.weekend_holiday_addition_pct) : "",
    );
    setHasFixedValues(record?.has_fixed_values ?? false);
    setFixedUrgencyDiff(record?.fixed_value_urgency_differentiation ?? false);
    setExclusionsNotes(record?.exclusions_notes ?? "");
    setExtraItems(record?.extra_items ?? []);
    setFreeNotes(record?.free_notes ?? "");
    setReplicaHospitalIds([]);
    setLockedHospitalIds([]);
  }, [open, record]);

  // Hospitais já vinculados ao acordo (replicação regional)
  useEffect(() => {
    if (!open || !record?.id) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("agreement_registration_hospitals")
        .select("hospital_id,is_primary,status")
        .eq("agreement_id", record.id);
      if (cancel) return;
      if (error) {
        toast.error("Falha ao carregar hospitais do acordo");
        return;
      }
      const rows = data ?? [];
      setReplicaHospitalIds(rows.filter((r) => !r.is_primary).map((r) => r.hospital_id));
      // Já aprovado/rejeitado pelo diretor: não pode mais ser removido pelo analista
      setLockedHospitalIds(
        rows.filter((r) => !r.is_primary && r.status !== "aguardando_diretor").map((r) => r.hospital_id),
      );
    })();
    return () => {
      cancel = true;
    };
  }, [open, record?.id]);

  useEffect(() => {
    if (!open || !hospitalId) return;
    let cancel = false;
    (async () => {
      setRegistriesLoading(true);
      try {
        const [comps, convRes, hospRes] = await Promise.all([
          fetchAllPaginated<CompanyOption>((from, to) =>
            supabase.from("companies").select("id,name,document,active").order("name").range(from, to),
          ),
          supabase
            .from("convenios")
            .select("slug,name")
            .or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
            .eq("active", true)
            .order("name"),
          supabase.from("hospitals").select("id,name").order("name"),
        ]);
        if (cancel) return;
        setCompanies(comps);
        if (convRes.error) throw convRes.error;
        setConvenios((convRes.data ?? []) as ConvenioOption[]);
        if (hospRes.error) throw hospRes.error;
        setHospitalOptions((hospRes.data ?? []) as HospitalOption[]);
      } catch (e: unknown) {
        if (!cancel) toast.error(e instanceof Error ? e.message : "Falha ao carregar cadastros");
      } finally {
        if (!cancel) setRegistriesLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId]);


  // Médicos vinculados à clínica selecionada (doctor_companies).
  // Busca em duas etapas e só dos ids vinculados — evita varrer a tabela inteira.
  useEffect(() => {
    if (!open || !hospitalId || !companyId) {
      setLinkedDoctors([]);
      return;
    }
    let cancel = false;
    (async () => {
      setDoctorsLoading(true);
      try {
        const { data, error } = await supabase
          .from("doctor_companies")
          .select("doctor_id")
          .eq("hospital_id", hospitalId)
          .eq("company_id", companyId);
        if (error) throw error;
        const ids = Array.from(new Set((data ?? []).map((r: { doctor_id: string }) => r.doctor_id)));
        if (cancel) return;
        if (ids.length === 0) {
          setLinkedDoctors([]);
          return;
        }
        const { data: docs, error: docsError } = await supabase
          .from("doctors")
          .select("id,full_name,crm,crm_uf")
          .in("id", ids)
          .order("full_name");
        if (docsError) throw docsError;
        if (!cancel) setLinkedDoctors((docs ?? []) as DoctorOption[]);
      } catch {
        if (!cancel) {
          toast.error("Falha ao carregar médicos vinculados à clínica");
          setLinkedDoctors([]);
        }
      } finally {
        if (!cancel) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, hospitalId, companyId]);

  const company = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );


  const stepError = useMemo((): string | null => {
    if (step === 0) {
      if (!companyId) return "Selecione a clínica no cadastro de empresas";
      if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom)
        return "Fim da vigência anterior ao início";
      return null;
    }
    if (step === 1) {
      if (!allConvenios && convenioExceptions.length === 0)
        return "Selecione ao menos um convênio";
      if (!allDoctors && doctorExceptions.length === 0) return "Selecione ao menos um médico";
      return null;
    }
    if (step === 2) {
      if (!paymentTableBase) return "Selecione a base da tabela de pagamento";
      if (paymentPercentage && numOrNull(paymentPercentage) == null) return "Percentual inválido";
      if (hasGlosa && !glosaConditions.trim()) return "Descreva as condições de glosa";
      return null;
    }
    if (step === 3) {
      if (urgencyDiff && numOrNull(urgencyPct) == null) return "Informe o acréscimo de urgência";
      if (weekendAdd && numOrNull(weekendPct) == null)
        return "Informe o acréscimo de fim de semana/feriado";
      return null;
    }
    if (step === 4) {
      if (extraItems.some((i) => !i.label.trim())) return "Preencha o rótulo dos itens extras";
      return null;
    }
    return null;
  }, [
    step, companyId, effectiveFrom, effectiveTo, allConvenios, convenioExceptions, allDoctors,
    doctorExceptions, paymentTableBase, paymentPercentage, hasGlosa, glosaConditions, urgencyDiff,
    urgencyPct, weekendAdd, weekendPct, extraItems,
  ]);

  const buildPayload = useCallback(
    (status: string) => ({
      hospital_id: hospitalId as string,
      company_id: companyId,
      effective_from: effectiveFrom || null,
      effective_to: effectiveTo || null,
      applies_to_all_convenios: allConvenios,
      convenio_exceptions: allConvenios ? [] : convenioExceptions,
      applies_to_all_doctors: allDoctors,
      doctor_exceptions: allDoctors ? [] : doctorExceptions,
      includes_auxiliary: includesAuxiliary,
      includes_access_route: includesAccessRoute,
      payment_table_base: paymentTableBase || null,
      payment_percentage: numOrNull(paymentPercentage),
      has_glosa: hasGlosa,
      glosa_conditions: hasGlosa ? glosaConditions.trim() || null : null,
      urgency_differentiation: urgencyDiff,
      urgency_addition_pct: urgencyDiff ? numOrNull(urgencyPct) : null,
      weekend_holiday_addition: weekendAdd,
      weekend_holiday_addition_pct: weekendAdd ? numOrNull(weekendPct) : null,
      has_fixed_values: hasFixedValues,
      fixed_value_urgency_differentiation: hasFixedValues ? fixedUrgencyDiff : false,
      exclusions_notes: exclusionsNotes.trim() || null,
      extra_items: extraItems.filter((i) => i.label.trim()) as unknown as Json,
      free_notes: freeNotes.trim() || null,
      status,
    }),
    [
      hospitalId, companyId, effectiveFrom, effectiveTo, allConvenios, convenioExceptions,
      allDoctors, doctorExceptions, includesAuxiliary, includesAccessRoute, paymentTableBase,
      paymentPercentage, hasGlosa, glosaConditions, urgencyDiff, urgencyPct, weekendAdd,
      weekendPct, hasFixedValues, fixedUrgencyDiff, exclusionsNotes, extraItems, freeNotes,
    ],
  );

  const persist = useCallback(
    async (status: string): Promise<boolean> => {
      if (!ensure("salvar o cadastro de acordo")) return false;
      setSaving(true);
      try {
        const payload = buildPayload(status);
        let agreementId = id;
        if (agreementId) {
          const { error } = await supabase
            .from("agreement_registrations")
            .update(payload)
            .eq("id", agreementId);
          if (error) throw error;
        } else {
          const { data: userRes } = await supabase.auth.getUser();
          const { data, error } = await supabase
            .from("agreement_registrations")
            .insert({ ...payload, filled_by: userRes?.user?.id ?? null })
            .select("id")
            .single();
          if (error) throw error;
          agreementId = data.id as string;
          setId(agreementId);
        }

        // Replicação regional: o hospital principal é criado pelo banco (is_primary).
        // Aqui sincronizamos apenas os hospitais adicionais ainda aguardando diretor.
        const { data: existing, error: existingErr } = await supabase
          .from("agreement_registration_hospitals")
          .select("hospital_id,is_primary,status")
          .eq("agreement_id", agreementId);
        if (existingErr) throw existingErr;
        const current = (existing ?? []).filter((r) => !r.is_primary);
        const desired = new Set(replicaHospitalIds.filter((h) => h !== hospitalId));
        const toInsert = [...desired].filter((h) => !current.some((r) => r.hospital_id === h));
        const toRemove = current
          .filter((r) => !desired.has(r.hospital_id) && r.status === "aguardando_diretor")
          .map((r) => r.hospital_id);

        if (toInsert.length > 0) {
          const { error } = await supabase.from("agreement_registration_hospitals").insert(
            toInsert.map((h) => ({ agreement_id: agreementId as string, hospital_id: h, is_primary: false })),
          );
          if (error) throw error;
        }
        if (toRemove.length > 0) {
          const { error } = await supabase
            .from("agreement_registration_hospitals")
            .delete()
            .eq("agreement_id", agreementId)
            .in("hospital_id", toRemove);
          if (error) throw error;
        }

        onSaved();
        return true;
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Falha ao salvar o acordo");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [buildPayload, ensure, id, onSaved, replicaHospitalIds, hospitalId],
  );


  const goNext = async () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    const ok = await persist("rascunho");
    if (!ok) return;
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  const finish = async () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    const ok = await persist("aguardando_supervisor");
    if (!ok) return;
    toast.success("Acordo enviado para validação do supervisor");
    onOpenChange(false);
  };

  const toggleIn = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const isLast = step === STEPS.length - 1;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="3xl"
      title={record ? `Acordo ${record.code}` : "Novo acordo"}
      description={`Etapa ${step + 1} de ${STEPS.length} — ${STEPS[step]}${hospital ? ` · ${hospital.name}` : ""}`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Fechar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={saving || step === 0}
          >
            Voltar
          </Button>
          {isLast ? (
            <Button type="button" onClick={() => void finish()} disabled={saving}>
              {saving ? "Salvando..." : "Concluir e enviar ao supervisor"}
            </Button>
          ) : (
            <Button type="button" onClick={() => void goNext()} disabled={saving}>
              {saving ? "Salvando..." : "Salvar e avançar"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">

        {/* Trilha de etapas */}
        <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1" aria-label="Etapas do acordo">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                i === step
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
              aria-pressed={i === step}
            >
              {i + 1}. {label}
            </button>
          ))}
        </nav>

        {/* Canvas do formulário: fundo suave para os cards de campos ganharem contraste */}
        <section className="rounded-xl border border-border bg-muted/40 p-3 sm:p-4">

        {/* Etapa 1 */}
        {step === 0 && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm">

            <div className="space-y-1.5">
              <Label>Clínica / grupo médico</Label>
              <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    disabled={registriesLoading}
                  >
                    {company ? company.name : registriesLoading ? "Carregando cadastro..." : "Buscar empresa no cadastro"}
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}
                  >
                    <CommandInput placeholder="Buscar por nome ou CNPJ" />
                    <CommandList>
                      <CommandEmpty>
                        <div className="p-3 text-left text-sm space-y-2">
                          <p className="font-medium">Empresa não encontrada no cadastro</p>
                          <p className="text-muted-foreground">
                            Não é permitido texto livre. Cadastre a empresa (entra como pendente de
                            revisão do admin) e volte para selecioná-la.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => window.open("/cadastros?tab=empresas", "_blank")}
                          >
                            Abrir cadastro de empresas
                          </Button>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {companies.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.document ?? ""}`}
                            onSelect={() => {
                              setCompanyId(c.id);
                              setDoctorExceptions([]);
                              setCompanyOpen(false);
                            }}
                          >
                            <Check
                              className={cn("mr-2 h-4 w-4", c.id === companyId ? "opacity-100" : "opacity-0")}
                            />
                            <span className="flex-1">{c.name}</span>
                            {!c.active && <Badge variant="secondary" className="ml-2">Inativa</Badge>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="acd-cnpj">CNPJ</Label>
                <Input
                  id="acd-cnpj"
                  value={company?.document ? formatCNPJ(company.document) : ""}
                  readOnly
                  disabled
                  className="w-52 bg-muted/50"
                  placeholder="Preenchido pela empresa"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acd-from">Início da vigência</Label>
                <Input
                  id="acd-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acd-to">Fim da vigência</Label>
                <Input
                  id="acd-to"
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className="w-44"
                />
              </div>
            </div>

            {/* Replicação regional: acordo fechado num hospital pode valer para os demais */}
            <div className="space-y-1.5">
              <Label>Replicar para outros hospitais da regional</Label>
              <Popover open={hospitalsOpen} onOpenChange={setHospitalsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    disabled={registriesLoading}
                  >
                    {replicaHospitalIds.length > 0
                      ? `${replicaHospitalIds.length} hospital(is) adicional(is)`
                      : registriesLoading
                        ? "Carregando hospitais..."
                        : "Somente o hospital de origem"}
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command filter={(value, search) => (norm(value).includes(norm(search)) ? 1 : 0)}>
                    <CommandInput placeholder="Buscar hospital" />
                    <CommandList>
                      <CommandEmpty>Nenhum hospital encontrado</CommandEmpty>
                      <CommandGroup>
                        {hospitalOptions
                          .filter((h) => h.id !== hospitalId)
                          .map((h) => {
                            const locked = lockedHospitalIds.includes(h.id);
                            return (
                              <CommandItem
                                key={h.id}
                                value={h.name}
                                disabled={locked}
                                onSelect={() => {
                                  if (locked) return;
                                  toggleIn(replicaHospitalIds, h.id, setReplicaHospitalIds);
                                }}
                              >
                                <Checkbox
                                  checked={replicaHospitalIds.includes(h.id)}
                                  className="mr-2"
                                  tabIndex={-1}
                                />
                                <span className="flex-1">{h.name}</span>
                                {locked && (
                                  <Badge variant="secondary" className="ml-2">
                                    Já avaliado
                                  </Badge>
                                )}
                              </CommandItem>
                            );
                          })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="outline" className="gap-1">
                  {hospital?.name ?? "Hospital atual"} · origem
                </Badge>
                {replicaHospitalIds.map((hid) => {
                  const h = hospitalOptions.find((o) => o.id === hid);
                  const locked = lockedHospitalIds.includes(hid);
                  return (
                    <Badge key={hid} variant="secondary" className="gap-1 pl-2 pr-1">
                      {h?.name ?? hid}
                      {!locked && (
                        <button
                          type="button"
                          aria-label={`Remover ${h?.name ?? "hospital"}`}
                          onClick={() => toggleIn(replicaHospitalIds, hid, setReplicaHospitalIds)}
                          className="rounded p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Cada hospital adicional entra como “aguardando diretor” e gera sua própria cópia da regra
                após a aprovação.
              </p>
            </div>


            <p className="text-xs text-muted-foreground">
              Responsável pelo preenchimento: usuário logado (gravado em <code>filled_by</code>).
            </p>
          </div>
        )}

        {/* Etapa 2 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Aplica-se a todos os convênios"
                value={allConvenios}
                onChange={setAllConvenios}
              />
              {!allConvenios && (
                <MultiPicker
                  emptyLabel="Nenhum convênio ativo nesta unidade"
                  options={convenios.map((c) => ({ id: c.slug, label: c.name }))}
                  selected={convenioExceptions}
                  onToggle={(v) => toggleIn(convenioExceptions, v, setConvenioExceptions)}
                  onClear={() => setConvenioExceptions([])}
                />
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Aplica-se a todos os médicos da clínica"
                value={allDoctors}
                onChange={setAllDoctors}
              />
              {!allDoctors && (
                <MultiPicker
                  emptyLabel={
                    doctorsLoading
                      ? "Carregando médicos da clínica..."
                      : "Nenhum médico vinculado a esta clínica (doctor_companies)"
                  }
                  options={linkedDoctors.map((d) => ({
                    id: d.id,
                    label: `${d.full_name}${d.crm ? ` — CRM ${d.crm}${d.crm_uf ? `/${d.crm_uf}` : ""}` : ""}`,
                  }))}
                  selected={doctorExceptions}
                  onToggle={(v) => toggleIn(doctorExceptions, v, setDoctorExceptions)}
                  onClear={() => setDoctorExceptions([])}
                />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <BoolField
                  label="Inclusão de auxiliar"
                  value={includesAuxiliary}
                  onChange={setIncludesAuxiliary}
                />
              </div>
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <BoolField
                  label="Inclusão de via de acesso"
                  value={includesAccessRoute}
                  onChange={setIncludesAccessRoute}
                />
              </div>
            </div>
          </div>
        )}


        {/* Etapa 3 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">

              <div className="space-y-1.5">
                <Label>Base da tabela de pagamento</Label>
                <Select value={paymentTableBase} onValueChange={setPaymentTableBase}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Selecione a base" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_TABLE_BASE_LABEL).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acd-pct">Percentual (%)</Label>
                <Input
                  id="acd-pct"
                  inputMode="decimal"
                  value={paymentPercentage}
                  onChange={(e) => setPaymentPercentage(e.target.value)}
                  className="w-28 text-right tabular-nums"
                  placeholder="100"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField label="Haverá glosa" value={hasGlosa} onChange={setHasGlosa} />
              {hasGlosa && (
                <div className="space-y-1.5">
                  <Label htmlFor="acd-glosa">Condições de glosa</Label>
                  <Textarea
                    id="acd-glosa"
                    rows={3}
                    value={glosaConditions}
                    onChange={(e) => setGlosaConditions(e.target.value)}
                    placeholder="Em que hipóteses a glosa é repassada à clínica"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Etapa 4 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Diferenciação por urgência/emergência"
                value={urgencyDiff}
                onChange={setUrgencyDiff}
              />
              {urgencyDiff && (
                <div className="space-y-1.5">
                  <Label htmlFor="acd-urg">Acréscimo de urgência (%)</Label>
                  <Input
                    id="acd-urg"
                    inputMode="decimal"
                    value={urgencyPct}
                    onChange={(e) => setUrgencyPct(e.target.value)}
                    className="w-28 text-right tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField
                label="Acréscimo fim de semana/feriado"
                value={weekendAdd}
                onChange={setWeekendAdd}
              />
              {weekendAdd && (
                <div className="space-y-1.5">
                  <Label htmlFor="acd-fds">Acréscimo fim de semana/feriado (%)</Label>
                  <Input
                    id="acd-fds"
                    inputMode="decimal"
                    value={weekendPct}
                    onChange={(e) => setWeekendPct(e.target.value)}
                    className="w-28 text-right tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
              <BoolField label="Há valores fixos" value={hasFixedValues} onChange={setHasFixedValues} />
              {hasFixedValues && (
                <BoolField
                  label="Valor fixo com diferenciação por urgência"
                  value={fixedUrgencyDiff}
                  onChange={setFixedUrgencyDiff}
                />
              )}
            </div>

            <div className="space-y-1.5 rounded-lg border border-border bg-card p-4 shadow-sm">

              <Label htmlFor="acd-exc">Exclusões / exceções</Label>
              <Textarea
                id="acd-exc"
                rows={4}
                value={exclusionsNotes}
                onChange={(e) => setExclusionsNotes(e.target.value)}
                placeholder="Procedimentos, códigos ou situações fora do acordo"
              />
            </div>
          </div>
        )}

        {/* Etapa 5 */}
        {step === 4 && (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            {extraItems.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nenhum item extra. Use o botão abaixo para adicionar pares rótulo/valor.
              </div>
            )}
            {extraItems.map((item, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <Label htmlFor={`acd-extra-l-${idx}`}>Rótulo</Label>
                  <Input
                    id={`acd-extra-l-${idx}`}
                    value={item.label}
                    onChange={(e) =>
                      setExtraItems((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, label: e.target.value } : it)),
                      )
                    }
                    placeholder="Ex.: Taxa de sala"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`acd-extra-v-${idx}`}>Valor</Label>
                  <Input
                    id={`acd-extra-v-${idx}`}
                    value={item.value}
                    onChange={(e) =>
                      setExtraItems((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it)),
                      )
                    }
                    className="w-40"
                    placeholder="Ex.: R$ 500,00"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setExtraItems((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Remover item extra"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExtraItems((prev) => [...prev, { label: "", value: "" }])}
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar item
            </Button>
          </div>
        )}

        {/* Etapa 6 */}
        {step === 5 && (
          <div className="space-y-1.5 rounded-lg border border-border bg-card p-4 shadow-sm">

            <Label htmlFor="acd-notes">Observações livres</Label>
            <Textarea
              id="acd-notes"
              rows={8}
              value={freeNotes}
              onChange={(e) => setFreeNotes(e.target.value)}
              placeholder="Qualquer condição acordada que não coube nos campos acima"
            />
            <p className="text-xs text-muted-foreground">
              Ao concluir, o registro passa para <strong>Aguardando supervisor</strong> e deixa de ser
              rascunho.
            </p>
          </div>
        )}

        </section>

        {stepError && <p className="text-xs text-destructive">{stepError}</p>}
      </div>
    </FormDialog>
  );
}

// Seletor múltiplo simples com busca — usado em convênios e médicos.
function MultiPicker({
  options,
  selected,
  onToggle,
  onClear,
  emptyLabel,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = norm(q);
    return n ? options.filter((o) => norm(o.label).includes(n)) : options;
  }, [options, q]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          className="flex-1 min-w-[200px]"
        />
        <Badge variant="secondary">{selected.length} selecionado(s)</Badge>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ScrollArea className="h-52 rounded-lg border border-border">
          <div className="p-2 space-y-1">
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60 cursor-pointer"
              >
                <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
                <span>{o.label}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">Nada encontrado para "{q}"</p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// Campo booleano com rótulos "Não | Sim" sempre visíveis.
// Switch puro obrigava o usuário a inferir o estado pela posição/cor.
function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <SegmentedControl
        ariaLabel={label}
        value={value ? "sim" : "nao"}
        onValueChange={(v) => onChange(v === "sim")}
        options={[
          { value: "nao", label: "Não" },
          { value: "sim", label: "Sim" },
        ]}
      />
    </div>
  );
}
