import { useEffect, useMemo, useState, useDeferredValue } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { useHospital } from "@/contexts/HospitalContext";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/FormDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Stethoscope, Plus, Power, Pencil, Upload, Download, Building2, X, IdCard, Phone, Mail, Briefcase, Tag } from "lucide-react";
import { ImportWizard, type ImportProfile } from "@/components/ImportWizard";
import { formatCPF, isValidCPF, onlyDigits as cpfOnlyDigits } from "@/lib/cpf";
import { formatCNPJ } from "@/lib/cnpj";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DoctorRegistrationPendingPanel } from "@/components/doctors/DoctorRegistrationPendingPanel";
import { DoctorPendingReviewPanel } from "@/components/doctors/DoctorPendingReviewPanel";
import { DoctorCompanySyncFaq } from "@/components/DoctorCompanySyncFaq";
import { RegistryAliasesPanel } from "@/components/RegistryAliasesPanel";
import { DoctorMissingSpecialtyPanel } from "@/components/doctors/DoctorMissingSpecialtyPanel";
import { DoctorLinkSuggestionsPanel } from "@/components/DoctorLinkSuggestionsPanel";
import { CompanyLinkSuggestionsPanel } from "@/components/CompanyLinkSuggestionsPanel";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSpecialties } from "@/hooks/useSpecialties";


const DOCTORS_IMPORT_PROFILE: ImportProfile = {
  entity: "doctors",
  supportedModes: ["append", "update", "replace"],
  fields: [
    // IMPORTANTE: ordem dos aliases prioriza "Nome Pessoa" (versão civil completa do Tasy).
    // Não incluir "nome" sozinho — o Tasy traz uma coluna "Nome" que costuma vir truncada
    // e o suggestMapping pegaria essa coluna por aparecer antes de "Nome Pessoa" na planilha.
    { key: "full_name", label: "Nome completo", required: true, aliases: ["nome pessoa", "nome_pessoa", "nomepessoa", "nome completo", "nome_completo"] },
    { key: "crm", label: "CRM", required: true, uniqueKey: true, aliases: ["crm", "registro", "crm/uf", "crm uf", "nr_crm"] },
    { key: "crm_uf", label: "UF do CRM", required: false, uniqueKey: true, aliases: ["uf", "estado", "uf_crm", "uf crm", "crm_uf"] },
    { key: "email", label: "E-mail", aliases: ["email", "e-mail"] },
    { key: "phone", label: "Telefone", aliases: ["telefone", "celular", "fone"] },
    { key: "specialties", label: "Especialidades", type: "array", aliases: ["especialidade", "especialidades"] },
    { key: "active", label: "Ativo", type: "boolean", aliases: ["ativo", "status", "situacao", "situação", "situacao medico", "situação médico", "situacao do medico", "situação do médico"], defaultValue: true },
    { key: "companies_raw", label: "Empresa(s)/PJ", type: "array", aliases: ["empresa", "empresas", "pj", "pjs", "clinica", "clínica"] },
  ],
};

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

interface Doctor {
  id: string;
  code: string | null;
  full_name: string;
  crm: string;
  crm_uf: string;
  email: string | null;
  phone: string | null;
  specialties: string[];
  active: boolean;
  notes: string | null;
  cpf: string | null;
  birth_date: string | null;
  vinculo: string | null;
}
interface Company { id: string; name: string; document: string | null; }
interface Link { doctor_id: string; company_id: string; hospital_id: string | null; start_date: string | null; end_date: string | null; end_reason: string | null; }

const empty: Doctor = {
  id: "", code: null, full_name: "", crm: "", crm_uf: "", email: "", phone: "",
  specialties: [], active: true, notes: "",
  cpf: "", birth_date: "", vinculo: "",
};

const norm = (s: string) =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) for (const rk of Object.keys(row)) {
    if (norm(rk).replace(/[\s_\-./]+/g, "").includes(norm(k).replace(/[\s_\-./]+/g, ""))) return row[rk];
  }
  return undefined;
};
const toStr = (v: unknown): string => v == null ? "" : String(v).trim();

function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const sa = new Set(x.split(/\s+/).filter((p) => p.length > 2));
  const sb = new Set(y.split(/\s+/).filter((p) => p.length > 2));
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  sa.forEach((p) => { if (sb.has(p)) common++; });
  return common / Math.max(sa.size, sb.size);
}

export default function Doctors({ embedded = false }: { embedded?: boolean } = {}) {
  const [items, setItems] = useState<Doctor[]>([]);
  const [totalDatabase, setTotalDatabase] = useState(0);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor>(empty);
  const [editingCompanyIds, setEditingCompanyIds] = useState<string[]>([]);
  const [specOpen, setSpecOpen] = useState(false);
  const { rows: specialtyRows, loading: specialtiesLoading } = useSpecialties();
  const specialtyNameSet = useMemo(
    () => new Set(specialtyRows.map((r) => r.name.toLowerCase())),
    [specialtyRows],
  );
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  // Vínculo médico↔PJ agora é por hospital (doctor_companies.hospital_id).
  // O seletor abaixo define em qual hospital os vínculos editados são gravados.
  const [linkHospitalId, setLinkHospitalId] = useState<string>("");
  const { hospital: activeHospital, availableHospitals } = useHospital();

  useEffect(() => {
    document.title = "Médicos | Exacta";
    load();

    // Realtime: vínculos editados na tela da PJ (CompanyDoctorsSection) refletem aqui sem F5.
    const ch = supabase
      .channel("doctors-page:doctor_companies")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "doctor_companies" },
        async () => {
          const { data } = await supabase
            .from("doctor_companies")
            .select("doctor_id,company_id,hospital_id,start_date,end_date,end_reason")
            .limit(50000);
          setLinks((data ?? []) as Link[]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);


  const load = async () => {
    try {
      setLoadingDoctors(true);
      // Carregamento de empresas e vínculos primeiro (são menores).
      // Paginação explícita: PostgREST trunca em 1000 linhas, então .limit(5000) por si só
      // perdia silenciosamente registros conforme a base cresce.
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const [companiesAll, linksAll, countResp] = await Promise.all([
        fetchAllPaginated<Company>((from, to) =>
          supabase
            .from("companies")
            .select("id,name,document")
            .eq("active", true)
            .order("name")
            .range(from, to),
        ),
        fetchAllPaginated<Link>((from, to) =>
          supabase
            .from("doctor_companies")
            .select("doctor_id,company_id,hospital_id,start_date,end_date,end_reason")
            .range(from, to),
        ),
        supabase.from("doctors").select("*", { count: 'exact', head: true }),
      ]);

      setCompanies(companiesAll);
      setLinks(linksAll);
      const total = countResp.count || 0;
      console.log(`Carregando base total: ${total} médicos`);
      setTotalDatabase(total);
      setItems([]);

      // A API REST retorna no máximo 1.000 linhas por resposta, mesmo quando a query pede mais.
      // Por isso o lote precisa ser <= 1.000; antes o lote 5.000 encerrava no primeiro retorno truncado.
      const PAGE_SIZE = 1000;
      let allDoctors: Doctor[] = [];
      
      // Loop robusto para garantir que TODA a base seja carregada
      for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("doctors")
          .select("*")
          .order("full_name")
          .range(offset, offset + PAGE_SIZE - 1);
        
        if (error) {
          console.error(`Erro no lote ${offset}:`, error);
          // Tenta novamente uma vez se falhar
          const retry = await supabase
            .from("doctors")
            .select("*")
            .order("full_name")
            .range(offset, offset + PAGE_SIZE - 1);
          
          if (retry.error) break;
          if (retry.data) {
            allDoctors = [...allDoctors, ...(retry.data as Doctor[])];
            setItems([...allDoctors]);
          }
        } else if (data) {
          allDoctors = [...allDoctors, ...(data as Doctor[])];
          setItems([...allDoctors]);
          if (data.length < PAGE_SIZE) break;
        }
      }
    } catch (err) {
      console.error("Erro fatal no carregamento:", err);
      toast({ title: "Erro ao carregar base", description: "Verifique sua conexão", variant: "destructive" });
    } finally {
      setLoadingDoctors(false);
    }
  };

  // Vínculos ATIVOS por médico (end_date IS NULL). Histórico fica separado.
  const linksByDoctor = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      if (l.end_date) continue;
      const arr = m.get(l.doctor_id) ?? [];
      // dedupe: o mesmo company_id pode aparecer em mais de um hospital
      if (!arr.includes(l.company_id)) arr.push(l.company_id);
      m.set(l.doctor_id, arr);
    }
    return m;
  }, [links]);

  // Vínculos ativos por (médico + hospital) — base do editor, que grava sempre
  // no hospital selecionado.
  const linksByDoctorHospital = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      if (l.end_date) continue;
      const key = `${l.doctor_id}|${l.hospital_id ?? ""}`;
      const arr = m.get(key) ?? [];
      if (!arr.includes(l.company_id)) arr.push(l.company_id);
      m.set(key, arr);
    }
    return m;
  }, [links]);

  // Histórico (vínculos encerrados) por médico
  const historyByDoctor = useMemo(() => {
    const m = new Map<string, Link[]>();
    for (const l of links) {
      if (!l.end_date) continue;
      const arr = m.get(l.doctor_id) ?? [];
      arr.push(l);
      m.set(l.doctor_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
    }
    return m;
  }, [links]);



  const companiesById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const openNew = () => {
    setEditing(empty);
    setLinkHospitalId(activeHospital?.id ?? "");
    setEditingCompanyIds([]);
    setSpecInput("");
    setCompanySearch("");
    setOpen(true);
  };

  const openEdit = async (d: Doctor) => {
    setEditing(d);
    const hid = activeHospital?.id ?? "";
    setLinkHospitalId(hid);
    setEditingCompanyIds(linksByDoctorHospital.get(`${d.id}|${hid}`) ?? []);
    setSpecInput("");
    setCompanySearch("");
    setOpen(true);
    // Dados sensíveis (CPF, nascimento, telefone, e-mail) só via RPC restrita a admin/diretor
    try {
      const { data: pii } = await supabase.rpc("get_doctors_pii", { doctor_ids: [d.id] });
      const row = Array.isArray(pii) ? pii[0] : null;
      if (row) {
        setEditing((prev) => prev.id === d.id ? {
          ...prev,
          cpf: (row as any).cpf ?? prev.cpf ?? "",
          birth_date: (row as any).birth_date ?? prev.birth_date ?? "",
          phone: (row as any).phone ?? prev.phone ?? "",
          email: (row as any).email ?? prev.email ?? "",
        } : prev);
      }
    } catch { /* usuário sem permissão para PII — mantém campos vazios */ }
  };

  const save = async () => {
    const name = editing.full_name.trim();
    const crm = editing.crm.trim();
    const uf = editing.crm_uf.trim().toUpperCase();
    if (!name) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    if (!crm) { toast({ title: "CRM obrigatório", variant: "destructive" }); return; }
    if (!uf) { toast({ title: "UF do CRM obrigatória", variant: "destructive" }); return; }
    if (!UFS.includes(uf)) { toast({ title: "UF inválida", variant: "destructive" }); return; }

    // Duplicidade por nome semelhante (alerta)
    const sims = items.filter((x) => x.id !== editing.id && similarity(x.full_name, name) >= 0.7);
    if (sims.length > 0 && !editing.id) {
      const ok = confirm(`Possível duplicidade encontrada:\n${sims.slice(0, 3).map((s) => `• ${s.full_name} (${s.crm}/${s.crm_uf})`).join("\n")}\n\nDeseja continuar mesmo assim?`);
      if (!ok) return;
    }

    const cpfClean = cpfOnlyDigits(editing.cpf ?? "");
    if (cpfClean && !isValidCPF(cpfClean)) {
      toast({ title: "CPF inválido", description: "Verifique os dígitos.", variant: "destructive" });
      return;
    }

    const payload = {
      full_name: name,
      crm,
      crm_uf: uf,
      email: editing.email?.trim() || null,
      phone: editing.phone?.trim() || null,
      specialties: editing.specialties,
      active: editing.active,
      notes: editing.notes?.trim() || null,
      cpf: cpfClean || null,
      birth_date: editing.birth_date?.trim() || null,
      vinculo: editing.vinculo?.trim() || null,
    };

    let savedId = editing.id;
    const original = editing.id ? items.find((x) => x.id === editing.id) : undefined;
    if (editing.id) {
      const { error } = await supabase.from("doctors").update(payload).eq("id", editing.id);
      if (error) { handleErr(error); return; }
    } else {
      const { data, error } = await supabase.from("doctors").insert(payload).select("id").single();
      if (error) { handleErr(error); return; }
      savedId = data.id;
    }

    // Propagação opcional para pagamentos EM ANDAMENTO (nunca para pagamentos finalizados).
    // Status finalizados/imutáveis: pago, arquivado, cancelado, rejeitado, lancado.
    if (editing.id && savedId && original) {
      const diff: Record<string, any> = {};
      if (original.full_name !== payload.full_name) diff.doctor_name = payload.full_name;
      if ((original.email ?? null) !== payload.email) diff.doctor_email = payload.email;
      if ((original.cpf ?? null) !== payload.cpf) diff.doctor_document = payload.cpf;
      const prevSpec = (original.specialties ?? [])[0] ?? null;
      const newSpec = (payload.specialties ?? [])[0] ?? null;
      if (prevSpec !== newSpec) diff.specialty = newSpec;

      if (Object.keys(diff).length > 0) {
        const FINALIZED = ["pago", "arquivado", "cancelado", "rejeitado", "lancado"];
        const { data: openPays } = await supabase
          .from("payments")
          .select("id,status")
          .not("status", "in", `(${FINALIZED.join(",")})`);
        const openIds = (openPays ?? []).map((p: any) => p.id);
        if (openIds.length > 0) {
          const { count } = await supabase
            .from("payment_items")
            .select("id", { count: "exact", head: true })
            .eq("doctor_id", savedId)
            .in("payment_id", openIds);
          const affected = count ?? 0;
          if (affected > 0) {
            const changedFields = Object.keys(diff).join(", ");
            const ok = confirm(
              `Foram alteradas as informações deste médico (${changedFields}).\n\n` +
              `Existem ${affected} item(ns) em ${openIds.length} pagamento(s) EM ANDAMENTO ` +
              `vinculados a este médico.\n\n` +
              `Deseja propagar a alteração para esses pagamentos em andamento?\n\n` +
              `(Pagamentos finalizados — pago, arquivado, cancelado, rejeitado, lancado — ` +
              `nunca serão alterados.)`
            );
            if (ok) {
              const { error: propErr } = await supabase
                .from("payment_items")
                .update(diff as any)
                .eq("doctor_id", savedId)
                .in("payment_id", openIds);
              if (propErr) {
                toast({ title: "Falha ao propagar alterações", description: propErr.message, variant: "destructive" });
              } else {
                toast({ title: "Alterações propagadas", description: `${affected} item(ns) atualizado(s) em pagamentos em andamento.` });
              }
            }
          }
        }
      }
    }


    // Vínculos: diff incremental preservando histórico (vigência).
    // Removidos → encerra com end_date = hoje. Adicionados → cria com start_date = hoje.
    if (savedId) {
      const today = new Date().toISOString().slice(0, 10);
      const yDate = new Date(); yDate.setDate(yDate.getDate() - 1);
      const yesterday = yDate.toISOString().slice(0, 10);
      if (!linkHospitalId) {
        toast({
          title: "Selecione o hospital do vínculo",
          description: "O vínculo médico↔PJ é por hospital. Escolha um hospital antes de salvar.",
          variant: "destructive",
        });
        return;
      }
      const previousIds = linksByDoctorHospital.get(`${savedId}|${linkHospitalId}`) ?? [];
      const toEnd = previousIds.filter((cid) => !editingCompanyIds.includes(cid));
      const toAdd = editingCompanyIds.filter((cid) => !previousIds.includes(cid));

      // Se for uma TROCA (encerra uma PJ e inicia outra na mesma data), pede
      // confirmação explícita — a troca vale para todo o sistema a partir de hoje.
      let applyLinkChanges = true;
      if (toEnd.length > 0 && toAdd.length > 0) {
        const oldNames = toEnd.map((cid) => companiesById.get(cid)?.name ?? cid).join(", ");
        const newNames = toAdd.map((cid) => companiesById.get(cid)?.name ?? cid).join(", ");
        applyLinkChanges = confirm(
          `Confirmar troca de PJ do médico?\n\n` +
          `• Encerrar vínculo com: ${oldNames}\n` +
          `• Iniciar vínculo com: ${newNames}\n\n` +
          `A troca passa a valer em TODO o sistema a partir de hoje (${today}).\n` +
          `Itens de pagamentos já finalizados (pago, arquivado, cancelado, rejeitado, lancado) ` +
          `permanecem inalterados. Pagamentos em andamento continuam apontando para a PJ antiga ` +
          `até serem reprocessados.\n\n` +
          `Deseja prosseguir com a troca?`
        );
      }

      // Acumula falhas de mutação de vínculo. Antes o código ignorava o `error`
      // dos delete()/update() e ainda mostrava toast de sucesso — o vínculo
      // continuava ativo no banco e o log de auditoria ficava vazio. Agora
      // qualquer falha aborta o fluxo e informa o usuário.
      const linkErrors: string[] = [];

      if (applyLinkChanges && toEnd.length > 0) {
        // Para permitir iniciar uma nova vigência hoje sem violar a constraint de
        // sobreposição (daterange '[]'), encerra a antiga em "ontem". Se o vínculo
        // antigo tiver começado hoje (sem histórico útil), deleta a linha.
        for (const cid of toEnd) {
          const { data: existing, error: selErr } = await supabase
            .from("doctor_companies")
            .select("id,start_date")
            .eq("doctor_id", savedId)
            .eq("company_id", cid)
            .eq("hospital_id", linkHospitalId)
            .is("end_date", null)
            .maybeSingle();
          if (selErr) { linkErrors.push(selErr.message); continue; }
          if (!existing) continue;
          if (existing.start_date && existing.start_date >= today) {
            // Zero-day: vínculo criado hoje sem histórico útil → remove.
            // Se algum dia um trigger de proteção passar a bloquear DELETE
            // nesta tabela, o erro cai aqui e o usuário é avisado (em vez de
            // silenciosamente falhar como antes).
            const { error: delErr } = await supabase
              .from("doctor_companies")
              .delete()
              .eq("id", existing.id);
            if (delErr) linkErrors.push(`Não foi possível remover o vínculo zero-day: ${delErr.message}`);
          } else {
            const { error: updErr } = await supabase
              .from("doctor_companies")
              .update({ end_date: yesterday, end_reason: toAdd.length > 0 ? "troca_pj" : "desvinculo_manual" })
              .eq("id", existing.id);
            if (updErr) linkErrors.push(`Não foi possível encerrar o vínculo: ${updErr.message}`);
          }
        }
      }

      if (applyLinkChanges && toAdd.length > 0 && linkErrors.length === 0) {
        // Blindagem: qualquer vínculo do médico com end_date=hoje (ex.: encerrado
        // em tentativa anterior antes do fix) sobrepõe o daterange '[]' e barra
        // o insert. Recua para ontem antes de inserir a nova PJ.
        const { error: shiftErr } = await supabase
          .from("doctor_companies")
          .update({ end_date: yesterday })
          .eq("doctor_id", savedId!)
          .eq("hospital_id", linkHospitalId)
          .eq("end_date", today);
        if (shiftErr) linkErrors.push(`Falha ao preparar nova vigência: ${shiftErr.message}`);

        if (linkErrors.length === 0) {
          const { error: linkErr } = await supabase.from("doctor_companies").insert(
            toAdd.map((cid) => ({ doctor_id: savedId!, company_id: cid, start_date: today, hospital_id: linkHospitalId })),
          );
          if (linkErr) {
            // Conflito de vigência é uma condição esperada — mensagem específica.
            linkErrors.push(
              "Vínculo conflita com PJ atual: existe outro vínculo vigente sobreposto. " +
              "Encerre-o antes de iniciar um novo na mesma data.",
            );
          } else {
            // Notificação em tempo real: vínculo MANUAL pela UI → avisa supervisores
            // se a PJ tem regra ativa com allowlist específica (modo híbrido).
            for (const cid of toAdd) {
              supabase.functions.invoke("notify-rule-pending-doctors", {
                body: { mode: "realtime", doctor_id: savedId, company_id: cid },
              }).catch((e) => console.warn("[notify-rule-pending] falhou", e));
            }
          }
        }
      }

      // Se algo falhou nos vínculos, avisa e mantém o modal aberto para retry —
      // o médico em si já foi salvo (update/insert acima). O usuário pode ajustar
      // e tentar de novo sem perder o trabalho.
      if (linkErrors.length > 0) {
        toast({
          title: "Alterações de vínculo não aplicadas",
          description: linkErrors.slice(0, 3).join(" • "),
          variant: "destructive",
        });
        await load(); // refetch para refletir estado real do banco
        return;
      }
    }

    toast({ title: editing.id ? "Médico atualizado" : "Médico criado" });
    setOpen(false);
    await load();
  };


  const handleErr = (error: any) => {
    if (error.code === "23505") {
      toast({
        title: "CRM duplicado",
        description: "Já existe um médico com este CRM nesta UF.",
        variant: "destructive",
      });
    } else {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  };

  // Soft delete: exclusão física foi bloqueada por trigger no banco para preservar
  // histórico de pagamentos, glosas e vínculos. Alternar active=true/false é o caminho.
  const toggleActive = async (d: Doctor) => {
    const next = !d.active;
    const msg = next
      ? `Reativar ${d.full_name}?`
      : `Inativar ${d.full_name}?\n\nO cadastro fica preservado (histórico intacto) e pode ser reativado a qualquer momento.`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from("doctors").update({ active: next } as any).eq("id", d.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: next ? "Médico reativado" : "Médico inativado" });
    load();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["nome", "crm", "uf", "email", "telefone", "especialidades", "ativo", "empresas", "observacoes"],
      ["Dr. João Silva", "12345", "DF", "joao@x.com", "(61) 99999-9999", "Cardiologia; Hemodinâmica", "sim", "Clínica X; Hospital Y", ""],
    ]);
    ws["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 6 }, { wch: 25 }, { wch: 18 }, { wch: 30 }, { wch: 8 }, { wch: 30 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Médicos");
    XLSX.writeFile(wb, "modelo-medicos.xlsx");
  };

  // Importação via wizard padrão (ImportWizard) — fluxo: upload → mapeamento → validação → confirmação → resumo.

  // Defer the heavy filter so typing stays responsive on bases with milhares de médicos.
  const deferredSearch = useDeferredValue(search);
  const deferredCompany = useDeferredValue(filterCompany);

  // Pre-normaliza os campos pesquisáveis uma única vez por mudança em `items`.
  // Sem isto, cada tecla refazia norm() ~25k vezes (5 campos × 4.7k médicos).
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of items) {
      const parts = [
        d.full_name,
        d.crm,
        d.code ?? "",
        d.email ?? "",
        ...(d.specialties ?? []),
      ];
      map.set(d.id, norm(parts.join(" ")));
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = norm(deferredSearch);
    const base = showInactive ? items : items.filter((d) => d.active);

    if (!q && !deferredCompany) return base;

    return base.filter((d) => {
      if (deferredCompany) {
        const cids = linksByDoctor.get(d.id) ?? [];
        if (!cids.includes(deferredCompany)) return false;
      }
      if (!q) return true;
      return (searchIndex.get(d.id) ?? "").includes(q);
    });
  }, [items, deferredSearch, deferredCompany, linksByDoctor, showInactive, searchIndex]);

  // Se houver busca, mostramos apenas os filtrados. 
  // Se não houver busca, mostramos os primeiros 100 para não travar o browser, 
  // mas garantimos que as ações de edição estejam sempre disponíveis.
  const displayItems = useMemo(() => {
    // Se há uma busca ativa, mostramos os resultados filtrados SEM limite (garantindo que todos apareçam)
    if (deferredSearch.trim() || deferredCompany) {
      return filtered;
    }
    // Sem busca ativa, mantemos a paginação de 100 itens para performance inicial
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filtered.slice(startIndex, startIndex + itemsPerPage);
  }, [filtered, currentPage, itemsPerPage, deferredSearch, deferredCompany]);

  const totalPages = itemsPerPage > 0 ? Math.ceil(filtered.length / itemsPerPage) : 1;

  // Resetar página quando a busca mudar
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterCompany]);

  const filteredCompaniesForDialog = useMemo(() => {
    const q = norm(companySearch);
    if (!q) return companies;
    return companies.filter((c) => norm(c.name).includes(q));
  }, [companies, companySearch]);

  return (
    <div className="flex flex-col h-full w-full max-w-[100vw] overflow-x-hidden">
      {!embedded && <PageHeader title="Médicos" description="Cadastro mestre de médicos para regras, vínculos com empresas e validações." />}
      <div className={embedded ? "w-full mx-auto space-y-4" : "p-4 md:p-8 w-full mx-auto space-y-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <Input
              placeholder="Buscar por nome, CRM, especialidade..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            <Select value={filterCompany || "_all"} onValueChange={(v) => setFilterCompany(v === "_all" ? "" : v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filtrar por empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Todas as empresas</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showInactive ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowInactive((s) => !s)}
              title="Inclui médicos inativados (cadastro preservado, mas fora de uso)"
            >
              {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> Modelo
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Importar
            </Button>
            <ImportWizard
              open={importOpen}
              onOpenChange={setImportOpen}
              title="Importar médicos"
              profile={DOCTORS_IMPORT_PROFILE}
              onComplete={() => load()}
            />
            <>
              <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo médico</Button>
              <FormDialog
                open={open}
                onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(empty); setEditingCompanyIds([]); } }}
                title={editing.id ? "Editar médico" : "Novo médico"}
                maxWidth="5xl"
                footer={
                  <div className="w-full flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button type="submit" form="doctor-form">Salvar</Button>
                  </div>
                }
              >
                <form id="doctor-form" onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-6">
                  {/* Seção 1 — Identificação */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <IdCard className="h-3.5 w-3.5" /> Identificação
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                      <div className="md:col-span-6 space-y-1.5">
                        <Label>Nome completo *</Label>
                        <Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
                      </div>
                      <div className="md:col-span-3 space-y-1.5">
                        <Label>CPF</Label>
                        <Input
                          value={editing.cpf ? formatCPF(editing.cpf) : ""}
                          onChange={(e) => setEditing({ ...editing, cpf: cpfOnlyDigits(e.target.value) })}
                          placeholder="000.000.000-00"
                          inputMode="numeric"
                          maxLength={14}
                        />
                      </div>
                      <div className="md:col-span-3 space-y-1.5">
                        <Label>Data de nascimento</Label>
                        <DateInput value={editing.birth_date ?? ""} onChange={(v) => setEditing({ ...editing, birth_date: v })} />
                      </div>
                    </div>
                  </section>

                  {/* Seção 2 — Conselho */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Stethoscope className="h-3.5 w-3.5" /> Conselho profissional
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2 space-y-1.5">
                        <Label>CRM *</Label>
                        <Input value={editing.crm} onChange={(e) => setEditing({ ...editing, crm: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>UF *</Label>
                        <Select value={editing.crm_uf} onValueChange={(v) => setEditing({ ...editing, crm_uf: v })}>
                          <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                          <SelectContent>
                            {UFS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </section>

                  {/* Seção 3 — Contato */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5" /> Contato
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>E-mail</Label>
                        <Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1"><Phone className="h-3 w-3" /> Telefone</Label>
                        <Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                      </div>
                    </div>
                  </section>

                  {/* Seção 4 — Atuação */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5" /> Atuação
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Vínculo</Label>
                        <Input
                          value={editing.vinculo ?? ""}
                          onChange={(e) => setEditing({ ...editing, vinculo: e.target.value })}
                          placeholder="Ex: Staff, Externo, Plantonista..."
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex items-center gap-2 pb-2">
                          <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                          <Label>Ativo</Label>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Especialidade(s)</Label>
                      {/* Somente valores do catálogo (tela de Especialidades): texto livre gerava divergência nos relatórios */}
                      <Popover open={specOpen} onOpenChange={setSpecOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                          >
                            {editing.specialties.length > 0
                              ? `${editing.specialties.length} selecionada(s)`
                              : "Selecionar especialidade..."}
                            <Tag className="h-3.5 w-3.5 opacity-60" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Buscar especialidade..." />
                            <CommandList>
                              <CommandEmpty>
                                {specialtiesLoading
                                  ? "Carregando..."
                                  : "Nenhuma especialidade encontrada. Cadastre em Cadastros › Especialidades."}
                              </CommandEmpty>
                              <CommandGroup>
                                {specialtyRows.map((row) => {
                                  const selected = editing.specialties.includes(row.name);
                                  return (
                                    <CommandItem
                                      key={row.id}
                                      value={row.name}
                                      onSelect={() => {
                                        setEditing({
                                          ...editing,
                                          specialties: selected
                                            ? editing.specialties.filter((s) => s !== row.name)
                                            : [...editing.specialties, row.name],
                                        });
                                      }}
                                    >
                                      <span className={selected ? "font-medium" : ""}>{row.name}</span>
                                      {selected && <span className="ml-auto text-xs text-primary">✓</span>}
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <div className="flex flex-wrap gap-1.5">
                        {editing.specialties.map((s, i) => {
                          const known = specialtyNameSet.has(s.toLowerCase());
                          return (
                            <Badge
                              key={i}
                              variant={known ? "secondary" : "outline"}
                              className={known ? "gap-1" : "gap-1 border-destructive/50 text-destructive"}
                              title={known ? undefined : "Especialidade fora do catálogo — revise o cadastro"}
                            >
                              {s}
                              <button type="button" onClick={() => setEditing({ ...editing, specialties: editing.specialties.filter((_, j) => j !== i) })}>×</button>
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  {/* Seção 5 — Empresas / PJs */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" /> Empresas / PJs vinculadas
                      {editingCompanyIds.length > 0 && (
                        <Badge variant="outline" className="text-[10px] h-4 ml-1">{editingCompanyIds.length}</Badge>
                      )}
                    </h3>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Hospital do vínculo <span className="text-destructive">*</span></Label>
                      <Select
                        value={linkHospitalId}
                        onValueChange={(v) => {
                          setLinkHospitalId(v);
                          setEditingCompanyIds(
                            editing.id ? (linksByDoctorHospital.get(`${editing.id}|${v}`) ?? []) : [],
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o hospital" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableHospitals.map((h) => (
                            <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        As PJs marcadas abaixo valem para este hospital. Troque o hospital para manter
                        vínculos simultâneos diferentes em cada unidade.
                      </p>
                    </div>
                    <Input
                      placeholder="Buscar empresa..."
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                    />
                    <div className="border border-border rounded-md max-h-48 overflow-y-auto p-2 space-y-1">
                      {filteredCompaniesForDialog.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2">Nenhuma empresa.</p>
                      )}
                      {filteredCompaniesForDialog.map((c) => {
                        const checked = editingCompanyIds.includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-2 py-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setEditingCompanyIds(
                                checked
                                  ? editingCompanyIds.filter((id) => id !== c.id)
                                  : [...editingCompanyIds, c.id]
                              )}
                            />
                            <span>{c.name}</span>
                            {c.document && <span className="text-xs text-muted-foreground">{c.document}</span>}
                          </label>
                        );
                      })}
                    </div>
                    {editingCompanyIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {editingCompanyIds.map((cid) => {
                          const c = companiesById.get(cid);
                          if (!c) return null;
                          return (
                            <Badge key={cid} variant="outline" className="gap-1">
                              {c.name}
                              <button type="button" onClick={() => setEditingCompanyIds(editingCompanyIds.filter((id) => id !== cid))}>
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    {editing.id && (historyByDoctor.get(editing.id)?.length ?? 0) > 0 && (
                      <div className="pt-2 border-t border-border/40">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                          Histórico de PJs encerradas
                        </p>
                        <div className="space-y-1">
                          {historyByDoctor.get(editing.id)!.map((h, i) => {
                            const c = companiesById.get(h.company_id);
                            const fmt = (iso: string | null) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—";
                            return (
                              <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                                <span className="truncate">{c?.name ?? "(PJ removida)"}</span>
                                <span className="font-mono text-[10px] shrink-0 ml-2">
                                  {fmt(h.start_date)} → {fmt(h.end_date)}
                                  {h.end_reason && <span className="ml-1 opacity-70">({h.end_reason})</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>


                  {/* Seção 6 — Notas operacionais (texto livre; vínculos vão na seção 5) */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Briefcase className="h-3.5 w-3.5" /> Notas operacionais
                    </h3>
                    <Textarea
                      value={editing.notes ?? ""}
                      onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                      placeholder="Lembretes, contatos adicionais. NÃO use para registrar vínculo com PJ — use a seção acima."
                    />
                    {(() => {
                      const matches = (editing.notes ?? "").match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g);
                      if (!matches || matches.length === 0) return null;
                      return (
                        <div className="text-xs rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 space-y-1">
                          <p className="font-semibold">⚠ CNPJ detectado nas notas — isso não cria vínculo.</p>
                          <p className="text-destructive/80">
                            Vínculo médico↔PJ só vale quando marcado na seção "Empresas / PJs vinculadas" acima.
                            Detectado: {matches.map(formatCNPJ).join(", ")}.
                            Após salvar, o admin verá a sugestão em <strong>Vínculos sugeridos</strong>.
                          </p>
                        </div>
                      );
                    })()}
                  </section>
                </form>
              </FormDialog>
            </>
          </div>
        </div>

        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list">Cadastro de médicos</TabsTrigger>
            <TabsTrigger value="provisional">Cadastros provisórios</TabsTrigger>
            <TabsTrigger value="pending">Pendências de cadastro</TabsTrigger>
            <TabsTrigger value="link-suggestions">Vínculos sugeridos</TabsTrigger>
            <TabsTrigger value="aliases">Aliases</TabsTrigger>
            <TabsTrigger value="missing-specialty">Especialidades pendentes</TabsTrigger>
          </TabsList>
          <TabsContent value="provisional" className="mt-4">
            <DoctorPendingReviewPanel />
          </TabsContent>
          <TabsContent value="pending" className="mt-4">
            <DoctorRegistrationPendingPanel />
          </TabsContent>
          <TabsContent value="link-suggestions" className="mt-4 space-y-4">
            <DoctorLinkSuggestionsPanel />
            <CompanyLinkSuggestionsPanel />
          </TabsContent>

          <TabsContent value="aliases" className="mt-4">
            <RegistryAliasesPanel kind="doctor" />
          </TabsContent>
          <TabsContent value="missing-specialty" className="mt-4">
            <DoctorMissingSpecialtyPanel />
          </TabsContent>
          <TabsContent value="list" className="mt-4 space-y-3">
        <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
          Vínculos médico ↔ PJ são sincronizados em tempo real: alterações feitas aqui aparecem no cadastro da PJ, e vice-versa.
        </p>
        <DoctorCompanySyncFaq />
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-semibold">
                  {filtered.length} médico(s) encontrados
                </span>
                {!search.trim() && !filterCompany && (
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {loadingDoctors
                      ? `Carregando ${items.length} de ${totalDatabase || "..."}`
                      : `Página ${currentPage} de ${totalPages || 1}`}
                  </span>
                )}
              </div>
              <span className="text-xs font-normal text-muted-foreground">
                Base total: {totalDatabase} médicos
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {displayItems.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Nenhum médico encontrado com o termo "{search}".</p>
                <p className="text-xs text-muted-foreground italic">Dica: Verifique se o nome está escrito corretamente ou tente buscar pelo CRM.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {displayItems.map((d) => (
                  <div key={d.id} className="p-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center">
                      <div className="sm:col-span-4 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
                          <p className="font-semibold text-sm truncate" title={d.full_name}>{d.full_name}</p>
                          {!d.active && <Badge variant="outline" className="text-[10px] h-4">Inativo</Badge>}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {d.code && (
                            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{d.code}</code>
                          )}
                          <p className="text-xs text-muted-foreground font-mono">{d.crm}/{d.crm_uf}</p>
                        </div>
                      </div>
                      <div className="sm:col-span-4 min-w-0">
                        <div className="flex flex-wrap gap-1">
                          {d.specialties?.map((s, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] break-all whitespace-normal">
                              {s}
                            </Badge>
                          ))}
                          {!d.specialties?.length && <span className="text-xs text-muted-foreground italic">Sem especialidade</span>}
                        </div>
                      </div>
                      <div className="sm:col-span-4 min-w-0 flex sm:justify-end">
                        <div className="flex flex-col sm:items-end gap-0.5 min-w-0">
                          <p className="text-xs truncate max-w-full" title={d.email || ""}>{d.email || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{d.phone || "—"}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)} className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleActive(d)}
                        className={`h-8 w-8 ${d.active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-emerald-600"}`}
                        title={d.active ? "Inativar (preserva histórico)" : "Reativar"}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          {!search.trim() && !filterCompany && totalPages > 1 && (
            <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/20">
              <div className="text-xs text-muted-foreground">
                Mostrando {displayItems.length} de {filtered.length} médicos
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => {
                    setCurrentPage(1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Primeira
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={currentPage === 1}
                  onClick={() => {
                    setCurrentPage(p => Math.max(1, p - 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Anterior
                </Button>
                <div className="text-sm font-medium min-w-[80px] text-center">
                  {currentPage} / {totalPages}
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={currentPage === totalPages}
                  onClick={() => {
                    setCurrentPage(p => Math.min(totalPages, p + 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Próxima
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => {
                    setCurrentPage(totalPages);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Última
                </Button>
              </div>
            </div>
          )}
        </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
