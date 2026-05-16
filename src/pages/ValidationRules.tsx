import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ShieldCheck, FileDown, Search, Filter, Check } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { RULE_SECTOR_LABELS, type RuleSector, PAYMENT_TYPE_LABELS, type PaymentType } from "@/lib/status";
import type { Database } from "@/integrations/supabase/types";

type ValidationRule = Database["public"]["Tables"]["validation_rules"]["Row"];
type AssistanceGroup = Database["public"]["Tables"]["assistance_groups"]["Row"];
type Kind = Database["public"]["Enums"]["validation_kind"];
type Severity = Database["public"]["Enums"]["validation_severity"];
type Action = Database["public"]["Enums"]["validation_action"];

const KIND_LABELS: Record<Kind, string> = {
  duplicidade_exata: "Cobrança duplicada",
  duplicidade_atendimento: "Duplicidade por atendimento/procedimento",
  sobreposicao_assistencial: "Sobreposição de grupo assistencial",
  codigo_sem_dobra: "Código sem dobra/acordo",
  codigo_nao_remuneravel: "Código não remunerável",
  item_em_pacote: "Item já incluído em pacote",
  particular_sem_excecao: "Particular sem exceção autorizada",
  outlier_valor: "Valor fora do padrão histórico",
  parecer_virou_cirurgia: "Parecer absorvido pela cirurgia",
  restricao_contratual: "Restrição contratual",
};

// Tipos visíveis no dropdown ao criar/editar (com descrição curta).
// Tipos antigos não listados continuam sendo exibidos em regras já cadastradas.
const VISIBLE_KINDS: Kind[] = [
  "duplicidade_exata",
  "sobreposicao_assistencial",
  "parecer_virou_cirurgia",
  "restricao_contratual",
  "outlier_valor",
];

const KIND_DESCRIPTIONS: Partial<Record<Kind, string>> = {
  duplicidade_exata:
    "Mesmo código cobrado mais de uma vez no mesmo atendimento e data. Configurável: verificar apenas o mesmo médico ou também médicos diferentes.",
  sobreposicao_assistencial:
    "Especialidades afins (ex: Geriatria e Cuidados Paliativos) fizeram visita ou parecer para o mesmo paciente no mesmo dia. Apenas um é remunerado.",
  parecer_virou_cirurgia:
    "Parecer seguido de cirurgia dentro do prazo configurado — o parecer não é pago separadamente pois está incluído na cirurgia.",
  restricao_contratual:
    "Item pode estar coberto pelo contrato fixo do médico ou empresa. O sistema verifica horário, dia da semana e código TUSS conforme o acordo. Requer confirmação do analista consultando a evolução clínica.",
  outlier_valor:
    "Valor acima do percentil configurado em relação ao histórico do mesmo procedimento. Apenas sinaliza para investigação — não bloqueia.",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  informativo: "Informativo — registra sem destaque",
  alerta: "Alerta — sinaliza para revisão",
  alerta_forte: "Alerta crítico — recomenda retirada",
  bloquear: "Bloqueio — impede envio sem resolução",
};

const ACTION_LABELS: Record<Action, string> = {
  informar: "Registrar e informar",
  alerta: "Sinalizar para revisão",
  alerta_forte: "Recomendar retirada do item",
  bloquear: "Bloquear envio até resolução",
};

const SEVERITY_VARIANT: Record<Severity, string> = {
  informativo: "bg-muted text-foreground",
  alerta: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  alerta_forte: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  bloquear: "bg-destructive/15 text-destructive",
};

const PAYMENT_TYPE_KEYS: PaymentType[] = ["producao", "remessa", "valor_fixo", "plantao"];

type DupExataParams = { compare_attendance: boolean; compare_patient: boolean; compare_date: boolean; compare_code: boolean; compare_doctor: boolean };
type DupAtendParams = { compare_attendance: boolean; compare_patient: boolean; compare_date: boolean; compare_code: boolean; allow_different_doctors: boolean };
type SobreposParams = { compare_attendance: boolean; compare_patient: boolean; compare_date: boolean; entry_type: "visita" | "parecer" | "qualquer" };

type OutlierLevel = "atendimento" | "procedimento" | "medico" | "tipo_atendimento";
type OutlierCriterion = "media_pct" | "percentil" | "multiplo_media";
type OutlierParams = {
  level: OutlierLevel;
  criterion: OutlierCriterion;
  pct_above_mean: number;
  percentile: number;
  mean_multiplier: number;
  min_history: number;
  same_company: boolean;
  same_attendance_type: boolean;
  same_procedure: boolean;
};

type ParecerCirurgiaParams = { prazo_horas: number; mesmo_medico: boolean };
type RestricaoContratualParams = {
  hora_inicio: string;
  hora_fim: string;
  dias_semana: number[];
  incluir_feriados: boolean;
  codigos_restritos: string[];
  observacao_analista: string;
};

const defaultParamsFor = (k: Kind): Record<string, unknown> => {
  switch (k) {
    case "duplicidade_exata":
      return { compare_attendance: true, compare_patient: true, compare_date: true, compare_code: true, compare_doctor: true };
    case "duplicidade_atendimento":
      return { compare_attendance: true, compare_patient: true, compare_date: true, compare_code: true, allow_different_doctors: true };
    case "sobreposicao_assistencial":
      return { compare_attendance: true, compare_patient: true, compare_date: true, entry_type: "" };
    case "parecer_virou_cirurgia":
      return { prazo_horas: 48, mesmo_medico: false } satisfies ParecerCirurgiaParams;
    case "restricao_contratual":
      return {
        hora_inicio: "08:00",
        hora_fim: "17:59",
        dias_semana: [1, 2, 3, 4, 5],
        incluir_feriados: false,
        codigos_restritos: [],
        observacao_analista: "",
      } satisfies RestricaoContratualParams;
    case "outlier_valor":
      return {
        level: "procedimento",
        criterion: "percentil",
        pct_above_mean: 50,
        percentile: 95,
        mean_multiplier: 2,
        min_history: 10,
        same_company: true,
        same_attendance_type: true,
        same_procedure: true,
      } satisfies OutlierParams;
    default:
      return {};
  }
};

interface FormState {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  severity: Severity;
  kind: Kind;
  action: Action;
  scope_global: boolean;
  sectors: RuleSector[];
  payment_types: PaymentType[];
  company_ids: string[];
  doctors: { name: string; document?: string }[];
  params: Record<string, unknown>;
  require_justification: boolean;
  allows_authorized_exception: boolean;
  assistance_group_id: string | null;
}

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  active: true,
  severity: "alerta",
  kind: "duplicidade_exata",
  action: "alerta",
  scope_global: true,
  sectors: [],
  payment_types: [],
  company_ids: [],
  doctors: [],
  params: defaultParamsFor("duplicidade_exata"),
  require_justification: false,
  allows_authorized_exception: false,
  assistance_group_id: null,
});

export default function ValidationRules() {
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [groups, setGroups] = useState<AssistanceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [companies, setCompanies] = useState<Record<string, CompanyOption>>({});
  const [allCompaniesMap, setAllCompaniesMap] = useState<Record<string, string>>({});
  const [filterText, setFilterText] = useState("");
  const [companyPicker, setCompanyPicker] = useState<CompanyOption | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<{ id?: string; name: string; description: string; specialties: string[]; active: boolean }>({ name: "", description: "", specialties: [], active: true });

  const load = async () => {
    setLoading(true);
    const [{ data: vr }, { data: ag }, { data: co }] = await Promise.all([
      supabase.from("validation_rules").select("*").order("created_at", { ascending: false }),
      supabase.from("assistance_groups").select("*").order("name"),
      supabase.from("companies").select("id, name"),
    ]);
    setRules(vr ?? []);
    setGroups(ag ?? []);
    
    if (co) {
      const map: Record<string, string> = {};
      co.forEach(c => map[c.id] = c.name);
      setAllCompaniesMap(map);
    }
    
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filteredRules = useMemo(() => {
    const q = filterText.toLowerCase().trim();
    if (!q) return rules;
    return rules.filter(r => {
      const name = r.name.toLowerCase();
      const desc = (r.description ?? "").toLowerCase();
      const kind = KIND_LABELS[r.kind].toLowerCase();
      
      // Busca pelo nome das empresas vinculadas (PJ)
      const companyNames = (r.company_ids as string[] ?? []).map(id => allCompaniesMap[id]?.toLowerCase() ?? "").join(" ");
      
      return name.includes(q) || desc.includes(q) || kind.includes(q) || companyNames.includes(q);
    });
  }, [rules, filterText, allCompaniesMap]);

  const openNew = () => { setForm(emptyForm()); setCompanyPicker(null); setOpen(true); };
  const openEdit = (r: ValidationRule) => {
    setForm({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      active: r.active,
      severity: r.severity,
      kind: r.kind,
      action: r.action,
      scope_global: r.scope_global,
      sectors: (r.sectors ?? []) as RuleSector[],
      payment_types: (r.payment_types ?? []) as PaymentType[],
      company_ids: (r.company_ids ?? []) as string[],
      doctors: Array.isArray(r.doctors) ? (r.doctors as any[]) : [],
      params: (r.params as Record<string, unknown>) ?? defaultParamsFor(r.kind),
      require_justification: r.require_justification,
      allows_authorized_exception: r.allows_authorized_exception,
      assistance_group_id: r.assistance_group_id,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Informe o nome da validação"); return; }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      active: form.active,
      severity: form.severity,
      kind: form.kind,
      action: form.action,
      scope_global: form.scope_global,
      sectors: form.scope_global ? [] : form.sectors,
      payment_types: form.scope_global ? [] : form.payment_types,
      company_ids: form.scope_global ? [] : form.company_ids,
      doctors: form.scope_global ? [] : form.doctors,
      params: form.params as never,
      require_justification: form.require_justification,
      allows_authorized_exception: form.allows_authorized_exception,
      assistance_group_id: form.kind === "sobreposicao_assistencial" ? form.assistance_group_id : null,
    };
    const res = form.id
      ? await supabase.from("validation_rules").update(payload).eq("id", form.id)
      : await supabase.from("validation_rules").insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(form.id ? "Validação atualizada" : "Validação criada");
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta validação?")) return;
    const { error } = await supabase.from("validation_rules").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Validação removida");
    load();
  };

  const exportRuleToPDF = (r: ValidationRule) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Regra de Validação Determinística", 14, 20);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`ID: ${r.id}`, 14, 28);
    doc.text(`Exportado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth - 14, 28, { align: 'right' });
    
    let currentY = 40;
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(r.name, 14, currentY);
    currentY += 8;
    
    const basicInfo = [
      ["Campo", "Valor"],
      ["Tipo (Kind)", KIND_LABELS[r.kind as Kind] ?? r.kind],
      ["Gravidade", SEVERITY_LABELS[r.severity as Severity] ?? r.severity],
      ["Ação", ACTION_LABELS[r.action as Action] ?? r.action],
      ["Status", r.active ? "Ativa" : "Inativa"],
      ["Escopo", r.scope_global ? "Global" : "Específico"]
    ];

    if (!r.scope_global) {
        if (Array.isArray(r.sectors) && r.sectors.length > 0) {
            basicInfo.push(["Setores Aplicáveis", r.sectors.join(", ")]);
        }
        if (Array.isArray(r.payment_types) && r.payment_types.length > 0) {
            basicInfo.push(["Tipos de Pagamento", r.payment_types.join(", ")]);
        }
        if (Array.isArray(r.company_ids) && r.company_ids.length > 0) {
            basicInfo.push(["Empresas Vinculadas", `${r.company_ids.length} empresa(s)`]);
        }
    }

    autoTable(doc, {
      startY: currentY,
      head: [basicInfo[0]],
      body: basicInfo.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] }
    });
    
    currentY = (doc as any).lastAutoTable.finalY + 15;
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Descrição", 14, currentY);
    currentY += 6;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const splitDesc = doc.splitTextToSize(r.description || "Sem descrição.", pageWidth - 28);
    doc.text(splitDesc, 14, currentY);
    currentY += (splitDesc.length * 5) + 15;

    // Params
    if (r.params) {
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Parâmetros Técnicos", 14, currentY);
        currentY += 6;
        
        const params = Object.entries(r.params as Record<string, any>).map(([k, v]) => [k, String(v)]);
        autoTable(doc, {
            startY: currentY,
            head: [["Parâmetro", "Valor"]],
            body: params,
            theme: 'grid'
        });
    }

    doc.save(`Validacao_${r.name.replace(/\s+/g, '_')}.pdf`);
    toast.success("PDF da regra de validação gerado.");
  };

  const exportAllToPDF = () => {
    if (rules.length === 0) return toast.error("Sem regras para exportar.");
    
    const doc = new jsPDF();
    const tableData = rules.map(r => [
        r.name,
        KIND_LABELS[r.kind as Kind] ?? r.kind,
        SEVERITY_LABELS[r.severity as Severity] ?? r.severity,
        r.active ? "Sim" : "Não"
    ]);

    doc.setFontSize(18);
    doc.text("Relatório de Regras de Validação", 14, 20);

    autoTable(doc, {
      startY: 30,
      head: [["Nome", "Tipo", "Gravidade", "Ativa"]],
      body: tableData,
      theme: 'grid'
    });

    doc.save("Relatorio_Validacoes.pdf");
    toast.success("Relatório de validações gerado.");
  };

  const saveGroup = async () => {
    if (!groupForm.name.trim()) { toast.error("Informe o nome do grupo"); return; }
    const payload = { name: groupForm.name.trim(), description: groupForm.description.trim() || null, specialties: groupForm.specialties, active: groupForm.active };
    const res = groupForm.id
      ? await supabase.from("assistance_groups").update(payload).eq("id", groupForm.id)
      : await supabase.from("assistance_groups").insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success("Grupo salvo");
    setGroupOpen(false);
    setGroupForm({ name: "", description: "", specialties: [], active: true });
    load();
  };

  const showParams = useMemo(() => {
    const k = form.kind;
    if (k === "duplicidade_exata") {
      const p = form.params as DupExataParams;
      const set = (patch: Partial<DupExataParams>) => setForm({ ...form, params: { ...p, ...patch } });
      const opts: Array<[keyof DupExataParams, string]> = [
        ["compare_attendance", "Atendimento"], ["compare_patient", "Paciente"], ["compare_date", "Data"],
        ["compare_code", "Código / procedimento"],
      ];
      // Toggle invertido: ON => ignora médico (compare_doctor=false). OFF => compara médico (compare_doctor=true).
      const ignoreDoctor = p.compare_doctor === false;
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {opts.map(([k2, label]) => (
              <label key={k2} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!p[k2]} onCheckedChange={(v) => set({ [k2]: !!v } as Partial<DupExataParams>)} />
                {label}
              </label>
            ))}
          </div>
          <div className="rounded-md border border-border p-3 space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={ignoreDoctor}
                onCheckedChange={(v) => set({ compare_doctor: !v })}
              />
              Considerar duplicidade mesmo com médicos diferentes
            </label>
            <p className="text-xs text-muted-foreground pl-6">
              Quando ativado: mesmo código + atendimento + data com qualquer médico é considerado duplicata.
              Quando desativado: apenas o mesmo médico.
            </p>
          </div>
        </div>
      );
    }
    if (k === "duplicidade_atendimento") {
      const p = form.params as DupAtendParams;
      const set = (patch: Partial<DupAtendParams>) => setForm({ ...form, params: { ...p, ...patch } });
      const opts: Array<[keyof DupAtendParams, string]> = [
        ["compare_attendance", "Atendimento"], ["compare_patient", "Paciente"],
        ["compare_date", "Data"], ["compare_code", "Código / procedimento"],
      ];
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {opts.map(([k2, label]) => (
              <label key={k2} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!p[k2]} onCheckedChange={(v) => set({ [k2]: !!v } as Partial<DupAtendParams>)} />
                {label}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!p.allow_different_doctors} onCheckedChange={(v) => set({ allow_different_doctors: !!v })} />
            Permitir médicos diferentes
          </label>
        </div>
      );
    }
    if (k === "sobreposicao_assistencial") {
      const p = form.params as SobreposParams;
      const set = (patch: Partial<SobreposParams>) => setForm({ ...form, params: { ...p, ...patch } });
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(["compare_attendance", "compare_patient", "compare_date"] as const).map((k2) => (
              <label key={k2} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!p[k2]} onCheckedChange={(v) => set({ [k2]: !!v } as Partial<SobreposParams>)} />
                {k2 === "compare_attendance" ? "Atendimento" : k2 === "compare_patient" ? "Paciente" : "Data"}
              </label>
            ))}
          </div>
          <div>
            <Label className="text-xs">Tipo de lançamento</Label>
            <Select value={p.entry_type || ""} onValueChange={(v) => set({ entry_type: v as SobreposParams["entry_type"] })}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="visita">Visita</SelectItem>
                <SelectItem value="parecer">Parecer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Grupo assistencial correlato</Label>
            <Select value={form.assistance_group_id ?? ""} onValueChange={(v) => setForm({ ...form, assistance_group_id: v || null })}>
              <SelectTrigger><SelectValue placeholder="Selecionar grupo…" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }
    if (k === "parecer_virou_cirurgia") {
      const p = form.params as ParecerCirurgiaParams;
      const set = (patch: Partial<ParecerCirurgiaParams>) => setForm({ ...form, params: { ...p, ...patch } });
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Prazo máximo entre o parecer e a cirurgia</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="number"
                min={1}
                className="w-24"
                value={p.prazo_horas ?? 48}
                onChange={(e) => set({ prazo_horas: Number(e.target.value) || 0 })}
              />
              <span className="text-sm text-muted-foreground">horas</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cirurgia realizada dentro deste prazo após o parecer cancela o pagamento do parecer. Padrão: 48 horas.
            </p>
          </div>
          <div className="rounded-md border border-border p-3 space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={!!p.mesmo_medico} onCheckedChange={(v) => set({ mesmo_medico: !!v })} />
              Aplicar apenas ao mesmo médico
            </label>
            <p className="text-xs text-muted-foreground pl-6">
              Quando ativado, só cancela o parecer se o mesmo médico realizou a cirurgia.
              Quando desativado, qualquer cirurgia no atendimento dentro do prazo cancela o parecer.
            </p>
          </div>
        </div>
      );
    }
    if (k === "restricao_contratual") {
      const p = form.params as RestricaoContratualParams;
      const set = (patch: Partial<RestricaoContratualParams>) => setForm({ ...form, params: { ...p, ...patch } });
      const dias: Array<[number, string]> = [
        [1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [0, "Dom"],
      ];
      const toggleDia = (n: number) => {
        const cur = new Set(p.dias_semana ?? []);
        if (cur.has(n)) cur.delete(n); else cur.add(n);
        set({ dias_semana: Array.from(cur).sort((a, b) => a - b) });
      };
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Horário restrito</Label>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Início</span>
                <Input type="time" className="w-32" value={p.hora_inicio ?? "08:00"}
                  onChange={(e) => set({ hora_inicio: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Fim</span>
                <Input type="time" className="w-32" value={p.hora_fim ?? "17:59"}
                  onChange={(e) => set({ hora_fim: e.target.value })} />
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs">Dias da semana</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {dias.map(([n, lbl]) => {
                const checked = (p.dias_semana ?? []).includes(n);
                return (
                  <button key={n} type="button" onClick={() => toggleDia(n)}
                    className={`text-xs px-3 py-1.5 rounded-md border ${checked ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!p.incluir_feriados} onCheckedChange={(v) => set({ incluir_feriados: !!v })} />
            Incluir feriados nesta restrição
          </label>
          <div>
            <Label className="text-xs">Códigos TUSS restritos neste horário</Label>
            <Textarea
              rows={3}
              value={(p.codigos_restritos ?? []).join("\n")}
              onChange={(e) => set({
                codigos_restritos: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="Um código por linha"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Deixe vazio para aplicar a todos os códigos. Ex: 40809170, 30804086
            </p>
          </div>
          <div>
            <Label className="text-xs">Observação para o analista</Label>
            <Textarea
              rows={2}
              value={p.observacao_analista ?? ""}
              onChange={(e) => set({ observacao_analista: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Esta mensagem aparece no alerta gerado. Ex: Verificar se o paciente é do cirurgião intervencionista — consultar evolução clínica.
            </p>
          </div>
        </div>
      );
    }
    if (k === "outlier_valor") {
      const p = form.params as OutlierParams;
      const set = (patch: Partial<OutlierParams>) => setForm({ ...form, params: { ...p, ...patch } });
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nível de análise</Label>
              <Select value={p.level} onValueChange={(v) => set({ level: v as OutlierLevel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="atendimento">Por atendimento</SelectItem>
                  <SelectItem value="procedimento">Por procedimento</SelectItem>
                  <SelectItem value="medico">Por médico</SelectItem>
                  <SelectItem value="tipo_atendimento">Por tipo de atendimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Critério</Label>
              <Select value={p.criterion} onValueChange={(v) => set({ criterion: v as OutlierCriterion })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="media_pct">Acima da média + X%</SelectItem>
                  <SelectItem value="percentil">Acima do percentil (P90/P95…)</SelectItem>
                  <SelectItem value="multiplo_media">Múltiplo da média (2x, 3x…)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {p.criterion === "media_pct" && (
              <div>
                <Label className="text-xs">% acima da média</Label>
                <Input type="number" min={0} value={p.pct_above_mean} onChange={(e) => set({ pct_above_mean: Number(e.target.value) || 0 })} />
              </div>
            )}
            {p.criterion === "percentil" && (
              <div>
                <Label className="text-xs">Percentil</Label>
                <Input type="number" min={50} max={99} value={p.percentile} onChange={(e) => set({ percentile: Number(e.target.value) || 0 })} />
              </div>
            )}
            {p.criterion === "multiplo_media" && (
              <div>
                <Label className="text-xs">Múltiplo da média</Label>
                <Input type="number" min={1} step={0.1} value={p.mean_multiplier} onChange={(e) => set({ mean_multiplier: Number(e.target.value) || 0 })} />
              </div>
            )}
            <div>
              <Label className="text-xs">Histórico mínimo (itens)</Label>
              <Input type="number" min={1} value={p.min_history} onChange={(e) => set({ min_history: Number(e.target.value) || 1 })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={p.same_company} onCheckedChange={(v) => set({ same_company: !!v })} />
              Mesma empresa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={p.same_attendance_type} onCheckedChange={(v) => set({ same_attendance_type: !!v })} />
              Mesmo tipo de atendimento
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={p.same_procedure} onCheckedChange={(v) => set({ same_procedure: !!v })} />
              Mesmo procedimento
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Não bloqueia automaticamente. Apenas gera alerta com valor atual, média histórica e diferença (%) para investigação.
          </p>
        </div>
      );
    }
    return <p className="text-xs text-muted-foreground">Sem parâmetros adicionais para este tipo.</p>;
  }, [form, groups]);

  return (
    <div>
      <PageHeader
        title="Regras de Validação"
        icon={ShieldCheck}
        description="Regras assistenciais e contratuais aplicadas automaticamente pelo sistema. Complementam a análise financeira sem alterá-la — cada alerta requer avaliação do analista."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportAllToPDF}><FileDown className="h-4 w-4 mr-2" /> Exportar Relatório</Button>
            <Button variant="outline" onClick={() => { setGroupForm({ name: "", description: "", specialties: [], active: true }); setGroupOpen(true); }}>
              Novo grupo assistencial
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nova validação</Button>
          </div>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 bg-muted/30 p-3 rounded-lg border border-border">
        <div className="flex items-center gap-2 text-muted-foreground mr-2">
          <Filter className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wider">Filtros</span>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Buscar por nome, PJ (empresa) ou tipo…" 
            className="pl-9 bg-background"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground ml-auto">
          {filteredRules.length} de {rules.length} regra{rules.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : filteredRules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            {filterText ? "Nenhuma validação encontrada para esta busca." : "Nenhuma validação cadastrada. Comece criando duplicidade exata e por atendimento."}
          </div>
        ) : (
          filteredRules.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-4 flex items-start gap-4">
              <ShieldCheck className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{r.name}</span>
                  <Badge variant="outline" className={SEVERITY_VARIANT[r.severity]}>{SEVERITY_LABELS[r.severity]}</Badge>
                  <Badge variant="outline">{KIND_LABELS[r.kind]}</Badge>
                  {!r.active && <Badge variant="outline" className="bg-muted">Inativa</Badge>}
                  {r.scope_global && <Badge variant="outline" className="text-xs">Global</Badge>}
                </div>
                {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  Ação: {ACTION_LABELS[r.action]}
                  {r.require_justification && " · Justificativa obrigatória"}
                  {r.allows_authorized_exception && " · Permite exceção autorizada"}
                </p>
                {r.company_ids && (r.company_ids as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(r.company_ids as string[]).map(id => (
                      <Badge key={id} variant="secondary" className="text-[10px] py-0 px-1 font-normal opacity-80">
                        {allCompaniesMap[id] || id.slice(0, 8)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => exportRuleToPDF(r)} title="Exportar PDF"><FileDown className="h-4 w-4 text-blue-600" /></Button>
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))
        )}
      </div>

      {groups.length > 0 && (
        <div className="mt-10">
          <h3 className="text-sm font-medium mb-2">Grupos assistenciais</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {groups.map((g) => (
              <div key={g.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{g.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setGroupForm({ id: g.id, name: g.name, description: g.description ?? "", specialties: g.specialties ?? [], active: g.active }); setGroupOpen(true); }}>Editar</Button>
                </div>
                {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                <div className="flex flex-wrap gap-1 mt-2">
                  {(g.specialties ?? []).map((s) => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-8">
          <DialogHeader><DialogTitle>{form.id ? "Editar validação" : "Nova validação"}</DialogTitle></DialogHeader>
          <div className="space-y-6">
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Dados básicos</h4>
              <div>
                <Label>Nome da validação</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-md border border-border p-2">
                  <Label className="text-sm">Ativa</Label>
                  <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                </div>
                <div>
                  <Label>Severidade</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as Severity })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SEVERITY_LABELS) as Severity[]).map((k) => <SelectItem key={k} value={k}>{SEVERITY_LABELS[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Tipo de regra</h4>
              <Select value={form.kind} onValueChange={(v) => { const k = v as Kind; setForm({ ...form, kind: k, params: defaultParamsFor(k) }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-w-[640px]">
                  {Array.from(new Set<Kind>([...VISIBLE_KINDS, form.kind])).map((k) => (
                    <SelectPrimitive.Item
                      key={k}
                      value={k}
                      className="relative flex w-full cursor-default select-none items-start rounded-sm py-2 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground"
                    >
                      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                        <SelectPrimitive.ItemIndicator>
                          <Check className="h-4 w-4" />
                        </SelectPrimitive.ItemIndicator>
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <SelectPrimitive.ItemText>
                          <span className="font-medium text-sm">{KIND_LABELS[k]}</span>
                        </SelectPrimitive.ItemText>
                        {KIND_DESCRIPTIONS[k] && (
                          <span className="text-xs text-muted-foreground whitespace-normal leading-snug">
                            {KIND_DESCRIPTIONS[k]}
                          </span>
                        )}
                      </div>
                    </SelectPrimitive.Item>
                  ))}
                </SelectContent>
              </Select>
              {KIND_DESCRIPTIONS[form.kind] && (
                <p className="text-xs text-muted-foreground">{KIND_DESCRIPTIONS[form.kind]}</p>
              )}
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Como identificar o conflito</h4>
              {showParams}
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Quem esta regra afeta</h4>
              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <Label className="text-sm">Aplicar a todos os médicos e empresas</Label>
                <Switch checked={form.scope_global} onCheckedChange={(v) => setForm({ ...form, scope_global: v })} />
              </div>
              {!form.scope_global && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Setores</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map((k) => {
                        const checked = form.sectors.includes(k);
                        return (
                          <button key={k} type="button" onClick={() => setForm({ ...form, sectors: checked ? form.sectors.filter((x) => x !== k) : [...form.sectors, k] })}
                            className={`text-xs px-2 py-1 rounded-md border ${checked ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>
                            {RULE_SECTOR_LABELS[k]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Tipos de pagamento</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {PAYMENT_TYPE_KEYS.map((k) => {
                        const checked = form.payment_types.includes(k);
                        return (
                          <button key={k} type="button" onClick={() => setForm({ ...form, payment_types: checked ? form.payment_types.filter((x) => x !== k) : [...form.payment_types, k] })}
                            className={`text-xs px-2 py-1 rounded-md border ${checked ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>
                            {PAYMENT_TYPE_LABELS[k]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Empresas</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {form.company_ids.map((id) => (
                        <Badge key={id} variant="outline" className="gap-1">
                          {allCompaniesMap[id] || id.slice(0, 8)}
                          <button onClick={() => setForm({ ...form, company_ids: form.company_ids.filter((x) => x !== id) })} className="ml-1">×</button>
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-2">
                      <CompanyCombobox value={companyPicker} onChange={(c) => {
                        if (!c) return;
                        if (!form.company_ids.includes(c.id)) {
                          setForm({ ...form, company_ids: [...form.company_ids, c.id] });
                        }
                        setCompanyPicker(null);
                      }} placeholder="Adicionar empresa…" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Médicos (nomes)</Label>
                    <MultiSelectChips
                      values={form.doctors.map((d) => d.name)}
                      onChange={(names) => setForm({ ...form, doctors: names.map((n) => ({ name: n })) })}
                      options={[]}
                      placeholder="Adicionar médico…"
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">O que o sistema faz ao detectar</h4>
              <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v as Action })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_LABELS) as Action[]).map((k) => <SelectItem key={k} value={k}>{ACTION_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Configurações de auditoria</h4>
              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <Label className="text-sm">Analista deve justificar antes de acatar o alerta</Label>
                <Switch checked={form.require_justification} onCheckedChange={(v) => setForm({ ...form, require_justification: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-2">
                <Label className="text-sm">Permitir que diretor autorize exceção</Label>
                <Switch checked={form.allows_authorized_exception} onCheckedChange={(v) => setForm({ ...form, allows_authorized_exception: v })} />
              </div>
              {form.allows_authorized_exception && (
                <p className="text-xs text-muted-foreground">A exceção ficará registrada com nome do autorizador e justificativa.</p>
              )}
            </section>
          </div>
          <DialogFooter className="p-6 pt-4 border-t bg-muted/10 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] overflow-y-auto sm:p-0 p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-6 pb-2"><DialogTitle>{groupForm.id ? "Editar grupo assistencial" : "Novo grupo assistencial"}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Ex: Cuidado clínico" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea rows={2} value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} />
            </div>
            <div>
              <Label>Especialidades correlatas</Label>
              <MultiSelectChips values={groupForm.specialties} onChange={(v) => setGroupForm({ ...groupForm, specialties: v })} options={[]} placeholder="Adicionar especialidade…" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-2">
              <Label className="text-sm">Ativo</Label>
              <Switch checked={groupForm.active} onCheckedChange={(v) => setGroupForm({ ...groupForm, active: v })} />
            </div>
          </div>
          <DialogFooter className="p-6 pt-2 border-t">
            <Button variant="outline" onClick={() => setGroupOpen(false)}>Cancelar</Button>
            <Button onClick={saveGroup}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
