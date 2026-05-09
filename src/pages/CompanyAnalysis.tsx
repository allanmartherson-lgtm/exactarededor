import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { recordObservation, type ObservationType } from "@/lib/observations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ItemsDataGrid } from "@/components/payment-detail/ItemsDataGrid";
import { CompanyHistoryPanel } from "@/components/payment-detail/CompanyHistoryPanel";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Building2, AlertTriangle, MessageSquarePlus, Sparkles, RefreshCcw, Send, History, XCircle, ShieldCheck, Undo2, ThumbsUp, ThumbsDown, FileText, Wallet, Upload, Download, FileSpreadsheet } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resolveResendTarget, canEditBatch, canActAsValidatorOrDirector, canReimportBatch } from "@/lib/paymentFlow";
import { claimPayment } from "@/lib/assignments";
// useAuth já importado acima
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Pencil already imported below
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatCurrency,
  TONE_CLASSES,
  type ItemAiStatus,
  type PaymentStatus,
} from "@/lib/status";
import { effectiveItemAiStatus } from "@/lib/paymentFlow";
import {
  usePaymentDetailData,
  type PaymentItemRow,
  type ObservationRow,
  type AiVersionRow,
  type AiFindings,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

import { Info, ShieldAlert, Pencil, MessageSquarePlus as MessageSquarePlusIcon } from "lucide-react";

const HighlightBanner = ({
  observations,
  profiles
}: {
  observations: ObservationRow[];
  profiles: Record<string, string>;
}) => {
  const highlights = useMemo(() => {
    return observations.filter(o => 
      o.observation_type === "impacta_aprovacao" || 
      o.observation_type === "justificativa_override"
    );
  }, [observations]);

  if (highlights.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {highlights.map((h) => (
        <div 
          key={h.id} 
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border shadow-sm animate-in fade-in slide-in-from-top-2 duration-300",
            h.observation_type === "impacta_aprovacao" 
              ? "bg-amber-50 border-amber-200" 
              : "bg-success-soft border-success/30"
          )}
        >
          <div className="mt-0.5">
            {h.observation_type === "impacta_aprovacao" ? (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            ) : (
              <Pencil className="h-4 w-4 text-success" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px] uppercase tracking-wider font-bold h-5 px-1.5",
                  h.observation_type === "impacta_aprovacao"
                    ? "border-amber-500/50 text-amber-700 bg-amber-100"
                    : "border-success/50 text-success-foreground bg-success/10"
                )}
              >
                {h.observation_type === "impacta_aprovacao" ? "Impacta Aprovação" : "Justificativa de Override"}
              </Badge>
              <span className="text-[10px] text-muted-foreground font-medium">
                {profiles[h.author_id!] || "Sistema"} · {new Date(h.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <p className={cn(
              "text-sm leading-relaxed",
              h.observation_type === "impacta_aprovacao" ? "font-bold text-amber-900" : "font-medium text-foreground"
            )}>
              {h.message}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

const ObservationTypeSelector = ({
  value,
  onChange,
  disabled
}: {
  value: ObservationType;
  onChange: (v: ObservationType) => void;
  disabled?: boolean;
}) => {
  return (
    <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-md border w-fit">
      <Button
        variant={value === "informativo" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2 text-[11px] gap-1.5"
        onClick={() => onChange("informativo")}
        disabled={disabled}
        type="button"
      >
        <Info className="h-3 w-3" />
        Informativo
      </Button>
      <Button
        variant={value === "impacta_aprovacao" ? "default" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-2 text-[11px] gap-1.5",
          value === "impacta_aprovacao" ? "bg-amber-500 hover:bg-amber-600 text-white" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
        )}
        onClick={() => onChange("impacta_aprovacao")}
        disabled={disabled}
        type="button"
      >
        <ShieldAlert className="h-3 w-3" />
        Impacta aprovação
      </Button>
      <Button
        variant={value === "justificativa_override" ? "default" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-2 text-[11px] gap-1.5",
          value === "justificativa_override" ? "bg-success hover:bg-success/90 text-white" : "text-success hover:text-success/90 hover:bg-success/10"
        )}
        onClick={() => onChange("justificativa_override")}
        disabled={disabled}
        type="button"
      >
        <Pencil className="h-3 w-3" />
        Justificativa
      </Button>
    </div>
  );
};
export default function CompanyAnalysis() {
  const { id, groupId } = useParams<{ id: string; groupId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const {
    payment,
    items: allItems,
    obs,
    groups,
    rulesIndex,
    rulesByName,
    profiles,
    assignments,
    load,
  } = usePaymentDetailData(id);

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const items = useMemo(() => {
    if (!group) return [] as PaymentItemRow[];
    const companyName = (group.company_name ?? "").trim().toLowerCase();
    return allItems.filter(
      (x) => (x.company_name ?? "Sem empresa").trim().toLowerCase() === companyName,
    );
  }, [allItems, group]);

  const [aiVersions, setAiVersions] = useState<AiVersionRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [changeCompanyOpen, setChangeCompanyOpen] = useState(false);
  const [newCompany, setNewCompany] = useState<CompanyOption | null>(null);
  const [changingCompany, setChangingCompany] = useState(false);
  const [isQuestion, setIsQuestion] = useState(false);
  const [groupCommentType, setGroupCommentType] = useState<ObservationType>("informativo");
  const [itemCommentType, setItemCommentType] = useState<Record<string, ObservationType>>({});

  const [editItem, setEditItem] = useState<PaymentItemRow | null>(null);
  const [editDraft, setEditDraft] = useState<{ gross_amount: string; specialty: string; doctor_name: string; description: string }>({ gross_amount: "", specialty: "", doctor_name: "", description: "" });
  const [savingItem, setSavingItem] = useState(false);
  const [deleteItem, setDeleteItem] = useState<PaymentItemRow | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [reimportConfirm, setReimportConfirm] = useState<File | null>(null);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = "Análise da empresa | MedPay Approval";
  }, []);

  // Versões da IA são exclusivas desta tela (aba "Detalhe IA"), busca dedicada.
  useEffect(() => {
    if (!id) return;
    let active = true;
    supabase
      .from("ai_analysis_versions")
      .select("*")
      .eq("payment_id", id)
      .order("version", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setAiVersions((data ?? []) as unknown as AiVersionRow[]);
      });
    return () => { active = false; };
  }, [id, obs.length]);

  const loading = !payment || !group;

  const gStatus = (group?.status ?? "em_analise_ia") as PaymentStatus;

  const counts = useMemo(() => {
    const c = { aprovado: 0, pendente: 0, alerta: 0, reprovado: 0, alertasTotal: 0, criticosTotal: 0 };
    for (const it of items) {
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : (eff as ItemAiStatus);
      c[bucket] = (c[bucket] ?? 0) + 1;
      
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (alerts.length > 0) {
        if (it.ai_status === "reprovado") c.criticosTotal += 1;
        else c.alertasTotal += 1;
      }
    }
    return c;
  }, [items, gStatus]);

  const divergentes = useMemo(
    () =>
      items.filter((it) => {
        const alerts = (it.ai_findings?.alerts ?? []) as string[];
        return alerts.length > 0 || it.ai_status === "alerta" || it.ai_status === "reprovado";
      }),
    [items],
  );

  const groupComments = useMemo(
    () => obs.filter((o) => !o.item_id),
    [obs],
  );
  const itemComments = (itemId: string) => obs.filter((o) => o.item_id === itemId);

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalistaRole = hasRole("analista") || hasRole("admin");
  const myAuthorType: "analista" | "validador" | "diretor" =
    gStatus === "aguardando_validacao" && isValidador ? "validador"
    : gStatus === "aguardando_aprovacao" && isDiretor ? "diretor"
    : isDiretor ? "diretor"
    : isValidador ? "validador"
    : "analista";

  const addItemComment = async (itemId: string) => {
    const text = (itemDraft[itemId] ?? "").trim();
    if (!text || !id) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      item_id: itemId,
      author_type: myAuthorType,
      author_id: user!.id,
      message: text,
      observation_type: itemCommentType[itemId] ?? "informativo",
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setItemDraft((m) => ({ ...m, [itemId]: "" }));
    load();
  };

  const addGroupComment = async () => {
    const text = groupDraft.trim();
    if (!text || !id || !group) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] ${text}`,
      is_question: isQuestion,
      observation_type: groupCommentType,
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setGroupDraft("");
    setIsQuestion(false);
    setGroupCommentType("informativo");
    load();
  };

  // Ações de fluxo (paridade com o popup de análise por empresa).
  const autoClaim = async () => {
    if (!id || !user) return;
    if (!(hasRole("analista") || hasRole("admin"))) return;
    await claimPayment(id, user.id, "auto");
  };

  const reanalyzeGroup = async () => {
    if (!id || !group) return;
    await autoClaim();
    setReanalyzing(true);
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: group.company_name },
      });
      if (error) throw error;
      await recordObservation({
        payment_id: id,
        author_type: myAuthorType,
        author_id: user!.id,
        message: `[${group.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
        status_from: group.status,
        status_to: group.status,
      });
      toast.success("Regras reaplicadas");
      load();
    } catch (e) {
      toast.error("Falha ao reaplicar regras", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setReanalyzing(false);
    }
  };

  const sendForValidation = async () => {
    if (!id || !group) return;
    if (!(group.status === "revisao_analista" || group.status === "devolvido_analista")) return;
    setBusy(true);
    await autoClaim();
    const target = resolveResendTarget(obs, group.company_name);
    const next = target?.nextStatus ?? "aguardando_validacao";
    const { error } = await supabase
      .from("payment_company_groups")
      .update({ status: next })
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Erro ao enviar", { description: error.message });
    }
    const text = groupDraft.trim();
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: target
        ? `[${group.company_name}] Reencaminhado ao ${target.role} pelo analista${text ? `: ${text}` : ""}.`
        : `[${group.company_name}] Enviado para validação pelo analista${text ? `: ${text}` : ""}.`,
      status_from: group.status,
      status_to: next,
    });
    setGroupDraft("");
    // Notifica todos os validadores (fila coletiva) + auditoria, somente quando vai para validação.
    if (next === "aguardando_validacao") {
      supabase.functions.invoke("notify-validator-assignment", {
        body: {
          payment_id: id,
          group_id: group.id,
          sender_id: user!.id,
        },
      }).catch((e) => console.warn("notify-validator-assignment failed", group.id, e));
    }
    setBusy(false);
    toast.success(target ? `Reencaminhado ao ${target.role}` : "Enviado para validação");
    load();
  };

  const cancelBatch = async () => {
    if (!id || !group) return;
    const text = groupDraft.trim();
    setBusy(true);
    // Cancela todos os grupos do lote + o próprio pagamento
    const { error: gErr } = await supabase
      .from("payment_company_groups")
      .update({ status: "cancelado" })
      .eq("payment_id", id);
    if (gErr) {
      setBusy(false);
      return toast.error("Erro ao cancelar", { description: gErr.message });
    }
    const { error: pErr } = await supabase
      .from("payments")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (pErr) {
      setBusy(false);
      return toast.error("Erro ao cancelar pagamento", { description: pErr.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Lote cancelado pelo analista${text ? `: ${text}` : "."}`,
      status_from: group.status,
      status_to: "cancelado",
    });
    setGroupDraft("");
    setBusy(false);
    toast.success("Lote cancelado");
    navigate(`/pagamentos/${id}`);
  };

  /**
   * Troca a empresa de TODOS os itens deste grupo. Usado quando o match
   * automático apontou a empresa errada. O sistema:
   *  1) reatribui os itens (company_id/company_name);
   *  2) move-os para o grupo da empresa correta — cria o grupo se não existir,
   *     e remove o grupo antigo se ficar vazio;
   *  3) registra o nome antigo como ALIAS na empresa nova (aprendizado);
   *  4) reanalisa a IA para os itens reatribuídos.
   */
  const changeGroupCompany = async () => {
    if (!id || !group || !newCompany || !user) return;
    if (newCompany.id === group.company_id) {
      toast.info("Esta já é a empresa do grupo.");
      return;
    }
    setChangingCompany(true);
    try {
      const oldName = group.company_name;
      const itemIds = items.map((it) => it.id);

      // 1) reatribui itens
      const { error: itErr } = await supabase
        .from("payment_items")
        .update({ company_id: newCompany.id, company_name: newCompany.name })
        .in("id", itemIds);
      if (itErr) throw itErr;

      // 2) acha/cria grupo destino
      const { data: existing } = await supabase
        .from("payment_company_groups")
        .select("id, items_count, total_amount")
        .eq("payment_id", id)
        .eq("company_id", newCompany.id)
        .maybeSingle();

      const total = items.reduce((s, it) => s + Number(it.gross_amount ?? 0), 0);

      let destGroupId = existing?.id ?? null;
      if (destGroupId) {
        await supabase
          .from("payment_company_groups")
          .update({
            items_count: (existing!.items_count ?? 0) + items.length,
            total_amount: Number(existing!.total_amount ?? 0) + total,
          })
          .eq("id", destGroupId);
      } else {
        const { data: created, error: cErr } = await supabase
          .from("payment_company_groups")
          .insert({
            payment_id: id,
            company_id: newCompany.id,
            company_name: newCompany.name,
            items_count: items.length,
            total_amount: total,
            status: "em_analise_ia",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        destGroupId = created.id;
      }

      // 3) remove grupo antigo (ficou vazio)
      await supabase.from("payment_company_groups").delete().eq("id", group.id);

      // 4) aprendizado de alias
      const { data: comp } = await supabase
        .from("companies")
        .select("aliases")
        .eq("id", newCompany.id)
        .single();
      const aliases = new Set<string>((comp?.aliases ?? []) as string[]);
      aliases.add(oldName);
      await supabase
        .from("companies")
        .update({ aliases: Array.from(aliases) })
        .eq("id", newCompany.id);

      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message: `[${oldName}] Empresa do grupo alterada para "${newCompany.name}" pelo analista. Apelido aprendido para futuras correspondências.`,
        status_from: group.status,
        status_to: group.status,
      });

      // 5) reanálise da IA para a empresa nova
      try {
        await supabase.functions.invoke("analyze-payment", {
          body: { payment_id: id, company_name: newCompany.name },
        });
      } catch (e) {
        console.warn("Reanálise pós-troca falhou (silencioso):", e);
      }

      toast.success("Empresa do grupo atualizada");
      setChangeCompanyOpen(false);
      setNewCompany(null);
      // Navega para o grupo destino — o antigo deixou de existir.
      navigate(`/pagamentos/${id}/empresa/${destGroupId}`);
    } catch (e) {
      toast.error("Falha ao trocar empresa", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChangingCompany(false);
    }
  };

  const doReimport = async (file: File) => {
    if (!id || !payment || !user) return;
    setReimporting(true);
    try {
      const { parsePaymentFile } = await import("@/lib/parsePaymentFile");
      const { data: companiesData } = await supabase.from("companies").select("id,name,aliases");
      const companies = (companiesData ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));
      const bucket = await parsePaymentFile(file, companies, payment.payment_kind);
      if (bucket.rows.length === 0) {
        toast.error("Arquivo vazio", { description: "Nenhuma linha válida encontrada." });
        return;
      }
      
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-files").upload(path, file);
      if (upErr) throw upErr;

      await supabase.from("payment_items").delete().eq("payment_id", id);
      await supabase.from("payment_company_groups").delete().eq("payment_id", id);

      const newItems = bucket.rows.map((r) => ({
        payment_id: id,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        gross_amount: r.gross_amount,
        company_name: r.company_name,
        company_id: r.company_id,
        attendance_number: r.attendance_number,
        procedure_code: r.procedure_code,
        procedure_name: r.procedure_name,
        access_route: r.access_route,
        doctor_role: r.doctor_role,
        agreement_text: r.agreement_text,
        specialty: r.specialty,
        procedure_amount: r.procedure_amount,
        quantity: r.quantity,
        procedure_date: r.procedure_date,
        patient_name: r.patient_name,
        raw_data: r.raw_data as never,
        tipo_linha: r.tipo_linha,
      }));
      const { error: insErr } = await supabase.from("payment_items").insert(newItems);
      if (insErr) throw insErr;

      const total = bucket.rows.reduce((s, r) => s + r.gross_amount, 0);
      await supabase.from("payments").update({
        source_file_path: path,
        total_amount: total,
        items_count: bucket.rows.length,
        status: "em_analise_ia",
      }).eq("id", id);

      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `Base reimportada pelo analista (${bucket.rows.length} itens, total ${total.toFixed(2)}). Arquivo: ${file.name}.`,
        status_from: payment.status, status_to: "em_analise_ia",
      });

      supabase.functions.invoke("analyze-payment", { body: { payment_id: id } });
      toast.success("Base reimportada", { description: "Reanalisando itens..." });
      
      // Como o grupo antigo sumiu, voltamos para a página do lote
      navigate(`/pagamentos/${id}`);
    } catch (e) {
      toast.error("Erro ao reimportar", { description: String(e) });
    } finally {
      setReimporting(false);
      setReimportConfirm(null);
      if (reimportInputRef.current) reimportInputRef.current.value = "";
    }
  };

  const openEditItem = (it: PaymentItemRow) => {
    setEditItem(it);
    setEditDraft({
      gross_amount: String(it.gross_amount ?? 0),
      specialty: it.specialty ?? "",
      doctor_name: it.doctor_name ?? "",
      description: it.description ?? "",
    });
  };

  const saveItem = async () => {
    if (!editItem || !id || !group) return;
    const newGross = Number(editDraft.gross_amount.replace(",", "."));
    if (Number.isNaN(newGross)) {
      toast.error("Valor inválido");
      return;
    }
    setSavingItem(true);
    try {
      const oldGross = Number(editItem.gross_amount ?? 0);
      const { error } = await supabase
        .from("payment_items")
        .update({
          gross_amount: newGross,
          specialty: editDraft.specialty || null,
          doctor_name: editDraft.doctor_name,
          description: editDraft.description || null,
          ai_status: "pendente",
        })
        .eq("id", editItem.id);
      if (error) throw error;
      const delta = newGross - oldGross;
      if (Math.abs(delta) > 0.001) {
        await supabase
          .from("payment_company_groups")
          .update({ total_amount: Number(group.total_amount ?? 0) + delta })
          .eq("id", group.id);
      }
      await recordObservation({
        payment_id: id,
        item_id: editItem.id,
        author_type: "analista",
        author_id: user!.id,
        message: `Item editado pelo analista (valor: ${oldGross} → ${newGross}).`,
      });
      try {
        await supabase.functions.invoke("analyze-payment", {
          body: { payment_id: id, company_name: group.company_name },
        });
      } catch (e) { console.warn("Reanálise pós-edição falhou:", e); }
      toast.success("Item atualizado");
      setEditItem(null);
      load();
    } catch (e) {
      toast.error("Falha ao salvar", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingItem(false);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deleteItem || !id || !group) return;
    setDeletingItem(true);
    try {
      const gross = Number(deleteItem.gross_amount ?? 0);
      const { error } = await supabase.from("payment_items").delete().eq("id", deleteItem.id);
      if (error) throw error;
      const remaining = items.length - 1;
      if (remaining <= 0) {
        await supabase.from("payment_company_groups").delete().eq("id", group.id);
      } else {
        await supabase
          .from("payment_company_groups")
          .update({
            items_count: remaining,
            total_amount: Math.max(0, Number(group.total_amount ?? 0) - gross),
          })
          .eq("id", group.id);
      }
      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user!.id,
        message: `[${group.company_name}] Item excluído pelo analista (${deleteItem.doctor_name} · ${formatCurrency(gross)}).`,
      });
      toast.success("Item excluído");
      setDeleteItem(null);
      if (remaining <= 0) navigate(`/pagamentos/${id}`);
      else load();
    } catch (e) {
      toast.error("Falha ao excluir", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeletingItem(false);
    }
  };

  // Transições de fluxo do validador/diretor para esta empresa.
  const transitionGroupStatus = async (
    nextStatus: PaymentStatus,
    authorType: "validador" | "diretor" | "analista",
    actionLabel: string,
    requireMsg: boolean,
  ) => {
    if (!id || !group) return;
    const text = groupDraft.trim();
    if (requireMsg && !text) {
      toast.error("Adicione um motivo", { description: "Justifique a devolução ou rejeição no campo de observação." });
      return;
    }
    setBusy(true);
    const updates: Record<string, unknown> = { status: nextStatus };
    if (authorType === "validador" && nextStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id;
      updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && nextStatus === "aprovado") {
      updates.approved_by = user!.id;
      updates.approved_at = new Date().toISOString();
    }
    if (authorType === "diretor" && nextStatus === "rejeitado") {
      updates.rejected_by = user!.id;
      updates.rejected_at = new Date().toISOString();
      updates.rejection_reason = text || null;
    }
    const { error } = await supabase
      .from("payment_company_groups")
      .update(updates as never)
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Falha ao atualizar", { description: error.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: authorType,
      author_id: user!.id,
      message: `[${group.company_name}] ${actionLabel}${text ? `: ${text}` : "."}`,
      status_from: group.status,
      status_to: nextStatus,
    });
    if (nextStatus === "aguardando_aprovacao") {
      supabase.functions.invoke("notify-director-approval", { body: { paymentId: id } })
        .catch((e) => console.warn("notify-director-approval failed", e));
    }
    if (nextStatus === "aprovado_em_revisao") {
      supabase.functions.invoke("notify-analyst-review", { body: { paymentId: id } })
        .catch((e) => console.warn("notify-analyst-review failed", e));
    }
    if (nextStatus === "devolvido_analista") {
      supabase.functions.invoke("notify-analyst-event", { 
        body: { 
          paymentId: id, 
          eventType: "returned",
          actorName: user?.user_metadata?.full_name || user?.email,
          reason: text 
        } 
      }).catch((e) => console.warn("notify-analyst-event failed", e));
    }
    setGroupDraft("");
    setBusy(false);
    toast.success(actionLabel);
    load();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Carregando análise…" />
      </div>
    );
  }

  if (!payment || !group) {
    return (
      <div className="space-y-4">
        <PageHeader title="Empresa não encontrada" />
        <Button variant="outline" onClick={() => navigate(`/pagamentos/${id}${groupId ? `#group-${groupId}` : ""}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
        </Button>
      </div>
    );
  }

  const isOwner = payment.created_by === user?.id;
  const isAnalista = hasRole("analista") || hasRole("admin");
  const isAdmin = hasRole("admin");
  const isAdminOrDiretor = hasRole("admin") || hasRole("diretor");
  const canEdit = canEditBatch(gStatus, { isOwner, isAnalista, isAdminOrDiretor });
  const canReimport = canReimportBatch(payment.status as PaymentStatus, { isOwner, isAnalista });
  const canActAsVD = canActAsValidatorOrDirector(payment.created_by, user?.id);
  // Governança: analista só atua se for o dono do lote (ou admin).
  // Validador/diretor só atuam se NÃO forem o criador (segregação de funções).
  const canActAnalista =
    (gStatus === "revisao_analista" || gStatus === "devolvido_analista" || gStatus === "aprovado_em_revisao") &&
    isAnalistaRole;
  const canActValidador = gStatus === "aguardando_validacao" && isValidador && canActAsVD;
  const canActDiretor = gStatus === "aguardando_aprovacao" && isDiretor && canActAsVD;
  const canAct = canActAnalista || canActValidador || canActDiretor;
  const returner = gStatus === "devolvido_analista" ? resolveResendTarget(obs, group.company_name)?.role ?? null : null;

  return (
    <div className="space-y-4 pb-32">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/pagamentos/${id}#group-${groupId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
            </Link>
          </Button>

          {canReimport && (
            <>
              <input
                ref={reimportInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setReimportConfirm(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || reimporting}
                onClick={() => reimportInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" /> {reimporting ? "Reimportando…" : "Reimportar base"}
              </Button>
              <AlertDialog open={!!reimportConfirm} onOpenChange={(v) => !v && !reimporting && setReimportConfirm(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reimportar base?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação <strong>substitui todos os itens e grupos</strong> deste lote pelo conteúdo de <strong>{reimportConfirm?.name}</strong> e reinicia a análise. Não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={reimporting}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={reimporting}
                      onClick={() => reimportConfirm && doReimport(reimportConfirm)}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {reimporting ? "Reimportando…" : "Confirmar"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
        <StatusBadge status={gStatus} />
      </div>

      {/* TOPO */}
      <Card className="shadow-card">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold leading-tight truncate">{group.company_name}</h1>
                {canEdit && (
                  <Dialog open={changeCompanyOpen} onOpenChange={setChangeCompanyOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7">
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Trocar empresa
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Trocar empresa do grupo</DialogTitle>
                        <DialogDescription>
                          Reatribui todos os {items.length} itens deste grupo à empresa selecionada.
                          O nome atual <strong>{group.company_name}</strong> será aprendido como apelido
                          para futuras correspondências automáticas. As regras serão reaplicadas em seguida.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-2">
                        <CompanyCombobox value={newCompany} onChange={setNewCompany} className="w-full" />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setChangeCompanyOpen(false)} disabled={changingCompany}>
                          Cancelar
                        </Button>
                        <Button onClick={changeGroupCompany} disabled={!newCompany || changingCompany}>
                          {changingCompany ? "Atualizando…" : "Confirmar troca"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lote: <span className="font-medium text-foreground">{payment.reference}</span>
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Itens"
              value={String(group.items_count ?? items.length)}
              tone="info"
              icon={<FileText className="h-4 w-4" />}
            />
            <Stat
              label="Valor total"
              value={formatCurrency(Number(group.total_amount ?? 0))}
              mono
              tone="success"
              icon={<Wallet className="h-4 w-4" />}
            />
            <Stat
              label="Alertas"
              value={String(counts.alertasTotal)}
              tone={counts.alertasTotal > 0 ? "warning" : "muted"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <Stat
              label="Críticos"
              value={String(counts.criticosTotal)}
              tone={counts.criticosTotal > 0 ? "destructive" : "muted"}
              icon={<ShieldAlert className="h-4 w-4" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* ABAS */}
      <Tabs defaultValue="analise" className="space-y-3">
        <TabsList>
          <TabsTrigger value="analise">Análise</TabsTrigger>
          <TabsTrigger value="divergencias">
            Divergências
            {divergentes.length > 0 && (
              <Badge variant="secondary" className="ml-2">{divergentes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History className="h-3.5 w-3.5 mr-1" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="ia">Detalhe IA</TabsTrigger>
        </TabsList>

        {/* ABA 1 — Análise */}
        <TabsContent value="analise" className="space-y-3">
          <HighlightBanner observations={obs} profiles={profiles} />
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Itens</CardTitle>
              <p className="text-xs text-muted-foreground">
                {items.length} itens · use os filtros do grid para focar em status, convênio, médico ou alertas.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ItemsDataGrid
                items={items}
                groupStatus={gStatus}
                rulesIndex={rulesIndex}
                rulesByName={rulesByName}
                observations={obs}
                profiles={profiles}
                storageKey="companyAnalysisPage"
                canEdit={canEdit}
                onEditItem={openEditItem}
                onDeleteItem={(it) => setDeleteItem(it)}
              />
            </CardContent>
          </Card>

          {/* Comentário geral da empresa */}
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                Comentário geral da empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                placeholder="Anote uma observação para esta empresa…"
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                rows={3}
              />
              <div className="flex flex-col gap-3">
                <ObservationTypeSelector
                  value={groupCommentType}
                  onChange={setGroupCommentType}
                  disabled={busy}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="is-question"
                      checked={isQuestion}
                      onCheckedChange={(v) => setIsQuestion(!!v)}
                    />
                    <Label htmlFor="is-question" className="text-xs font-normal cursor-pointer select-none">
                      É um questionamento ao diretor (aguarda resposta)
                    </Label>
                  </div>
                  <Button size="sm" onClick={addGroupComment} disabled={busy || !groupDraft.trim()}>
                    Adicionar comentário
                  </Button>
                </div>
              </div>
              {groupComments.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {groupComments.slice(0, 5).map((o) => (
                    <li key={o.id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      <div className="text-muted-foreground mb-0.5">
                        {o.author_type}
                        {o.author_id && profiles[o.author_id] ? ` · ${profiles[o.author_id]}` : ""}
                        {" · "}{new Date(o.created_at).toLocaleString("pt-BR")}
                      </div>
                      <div className="whitespace-pre-wrap">{o.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2 — Divergências */}
        <TabsContent value="divergencias" className="space-y-3">
          {divergentes.length === 0 ? (
            <Card className="shadow-card">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma divergência identificada para esta empresa.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {divergentes.map((it) => (
                <DivergenceCard
                  key={it.id}
                  it={it}
                  comments={itemComments(it.id)}
                  profiles={profiles}
                  draft={itemDraft[it.id] ?? ""}
                  onDraftChange={(v) => setItemDraft((m) => ({ ...m, [it.id]: v }))}
                  type={itemCommentType[it.id] ?? "informativo"}
                  onTypeChange={(v) => setItemCommentType((m) => ({ ...m, [it.id]: v }))}
                  onAdd={() => addItemComment(it.id)}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ABA — Histórico unificado (IA + analistas/validadores/diretores) */}
        <TabsContent value="historico" className="space-y-3">
          <CompanyHistoryPanel
            items={items}
            observations={obs}
            aiVersions={aiVersions}
            assignments={assignments}
            profiles={profiles}
          />
        </TabsContent>

        {/* ABA 3 — Detalhe IA */}
        <TabsContent value="ia" className="space-y-3">
          <AiDetail items={items} versions={aiVersions} />
        </TabsContent>
      </Tabs>

      {/* Footer sticky com ações de fluxo */}
      {canAct && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
          <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row md:items-start gap-2">
            <div className="flex flex-col md:flex-1 gap-2">
              <Textarea
                rows={2}
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                placeholder="Observação para esta empresa (obrigatória para devolver)..."
                className="w-full text-xs"
              />
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  id="footer-is-question"
                  checked={isQuestion}
                  onCheckedChange={(v) => setIsQuestion(!!v)}
                />
                <Label htmlFor="footer-is-question" className="text-[11px] font-normal cursor-pointer select-none">
                  Marcar como questionamento ao diretor
                </Label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
              {canActAnalista && (
                <>
                  {(gStatus === "revisao_analista" || gStatus === "devolvido_analista") && (
                    <>
                      <Button variant="outline" size="sm" onClick={reanalyzeGroup} disabled={busy || reanalyzing}>
                        <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzing && "animate-spin")} />
                        {reanalyzing ? "Reaplicando..." : "Reaplicar regras"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busy} className="text-destructive hover:text-destructive">
                            <XCircle className="h-4 w-4 mr-2" /> Cancelar lote
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancelar este lote?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação marca todos os grupos do lote como cancelados e encerra o fluxo de aprovação.
                              Use quando o pagamento não deve ser processado (ex.: base enviada por engano).
                              A observação registrada acima (se houver) será anexada ao histórico.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Voltar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={cancelBatch}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Cancelar lote
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      {returner ? (
                        <Button size="sm" onClick={() => sendForValidation()} disabled={busy}>
                          <Send className="h-4 w-4 mr-2" />
                          Reencaminhar ao {returner}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => sendForValidation()} disabled={busy}>
                          <Send className="h-4 w-4 mr-2" />
                          Enviar para validação
                        </Button>
                      )}
                    </>
                  )}
                  {gStatus === "aprovado_em_revisao" && (
                    <Button
                      size="sm"
                      onClick={() => transitionGroupStatus("pedido_nf_enviado", "analista", "Pedido de nota enviado pelo analista", false)}
                      disabled={busy}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Enviar pedido de nota
                    </Button>
                  )}
                </>
              )}
              {canActValidador && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("devolvido_analista", "validador", "Devolvido ao analista pelo validador", true)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" /> Devolver ao analista
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("aguardando_aprovacao", "validador", "Validado e enviado para aprovação", false)}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" /> Validar e enviar para aprovação
                  </Button>
                </>
              )}
              {canActDiretor && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("devolvido_analista", "diretor", "Devolvido ao analista pelo diretor", true)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" /> Devolver ao analista
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="text-destructive hover:text-destructive"
                    onClick={() => transitionGroupStatus("rejeitado", "diretor", "Rejeitado pelo diretor", true)}
                  >
                    <ThumbsDown className="h-4 w-4 mr-2" /> Rejeitar
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("aprovado_em_revisao", "diretor", "Aprovado pelo diretor", false)}
                  >
                    <ThumbsUp className="h-4 w-4 mr-2" /> Aprovar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editar item */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar item</DialogTitle>
            <DialogDescription>
              Ajuste valores ou metadados desta linha. O item será reanalisado pela IA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Médico</Label>
              <Input value={editDraft.doctor_name} onChange={(e) => setEditDraft((d) => ({ ...d, doctor_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input value={editDraft.gross_amount} onChange={(e) => setEditDraft((d) => ({ ...d, gross_amount: e.target.value }))} inputMode="decimal" />
            </div>
            <div>
              <Label className="text-xs">Especialidade</Label>
              <Input value={editDraft.specialty} onChange={(e) => setEditDraft((d) => ({ ...d, specialty: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} disabled={savingItem}>Cancelar</Button>
            <Button onClick={saveItem} disabled={savingItem}>{savingItem ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir item */}
      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem && (
                <>Remove a linha de <strong>{deleteItem.doctor_name}</strong> ({formatCurrency(Number(deleteItem.gross_amount ?? 0))}). Os totais do grupo serão recalculados.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingItem}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteItem} disabled={deletingItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingItem ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  // Cada tom tem: chip do ícone (fundo soft + texto da cor) e barra lateral.
  // Mantém fundo branco do card pra preservar a estética financeira sóbria,
  // mas usa o acento de cor pra deixar cada KPI visualmente distinto.
  const tones: Record<typeof tone, { chip: string; bar: string; value: string }> = {
    muted: {
      chip: "bg-muted text-muted-foreground",
      bar: "bg-border",
      value: "text-foreground",
    },
    info: {
      chip: "bg-info-soft text-info",
      bar: "bg-info",
      value: "text-foreground",
    },
    success: {
      chip: "bg-success-soft text-success",
      bar: "bg-success",
      value: "text-foreground",
    },
    warning: {
      chip: "bg-warning-soft text-warning-foreground",
      bar: "bg-warning",
      value: "text-warning-foreground",
    },
    destructive: {
      chip: "bg-destructive/10 text-destructive",
      bar: "bg-destructive",
      value: "text-destructive",
    },
  };
  const t = tones[tone];
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card shadow-soft">
      <span aria-hidden className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />
      <div className="flex items-start gap-3 px-3 py-3 pl-4">
        {icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-md flex-shrink-0", t.chip)}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn("mt-1 text-xl font-semibold leading-tight", mono && "tabular-nums", t.value)}>{value}</div>
        </div>
      </div>
    </div>
  );
}

// ItemsTable foi substituída por <ItemsDataGrid /> compartilhado.

function DivergenceCard({
  it,
  comments,
  profiles,
  draft,
  onDraftChange,
  type,
  onTypeChange,
  onAdd,
  busy,
}: {
  it: PaymentItemRow;
  comments: ObservationRow[];
  profiles: Record<string, string>;
  draft: string;
  onDraftChange: (v: string) => void;
  type: ObservationType;
  onTypeChange: (v: ObservationType) => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
  const isCritico = it.ai_status === "reprovado";
  const expected = it.ai_findings?.expected_amount;
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const paciente =
    (it.patient_name as string | null) ??
    ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
    "—";
  return (
    <Card
      className={cn(
        "shadow-card border-l-4",
        isCritico ? "border-l-destructive" : "border-l-warning",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isCritico ? (
                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{paciente}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground truncate">{it.doctor_name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {it.procedure_code && (
                <span>
                  TUSS: <span className="font-mono text-foreground">{it.procedure_code}</span>
                </span>
              )}
              {it.attendance_number && (
                <span>
                  Atend.: <span className="font-mono text-foreground">{it.attendance_number}</span>
                </span>
              )}
              <span>
                Valor: <span className="tabular-nums text-foreground">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
              </span>
              {expected != null && (
                <span>
                  Esperado: <span className="tabular-nums text-foreground">{formatCurrency(Number(expected))}</span>
                </span>
              )}
            </div>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[10px] shrink-0",
              isCritico ? TONE_CLASSES.destructive : TONE_CLASSES.warning,
            )}
          >
            {isCritico ? "Crítico" : "Alerta"}
          </span>
        </div>

        {alerts.length > 0 && (
          <ul className="space-y-1 text-xs">
            {alerts.map((a, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span className="whitespace-pre-wrap">{a}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Comentários por item */}
        {comments.length > 0 && (
          <ul className="space-y-1.5">
            {comments.slice(0, 3).map((o) => (
              <li key={o.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <div className="text-muted-foreground text-[10px] mb-0.5">
                  {o.author_type}
                  {o.author_id && profiles[o.author_id] ? ` · ${profiles[o.author_id]}` : ""}
                  {" · "}{new Date(o.created_at).toLocaleString("pt-BR")}
                </div>
                <div className="whitespace-pre-wrap">{o.message}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Textarea
              placeholder="Comentar este item…"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={2}
              className="flex-1"
            />
            <Button size="sm" onClick={onAdd} disabled={busy || !draft.trim()} className="self-end">
              Comentar
            </Button>
          </div>
          <ObservationTypeSelector
            value={type}
            onChange={onTypeChange}
            disabled={busy}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AiDetail({ items, versions }: { items: PaymentItemRow[]; versions: AiVersionRow[] }) {
  const withExplanation = items.filter((it) => {
    const f = it.ai_findings as AiFindings | null;
    return (
      (f?.calculation_explanation && f.calculation_explanation.trim().length > 0) ||
      (f?.matched_rules && f.matched_rules.length > 0)
    );
  });
  if (withExplanation.length === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma explicação de regra disponível para esta empresa.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {withExplanation.map((it) => {
        const f = it.ai_findings as AiFindings;
        const lastVersion = versions.find((v) => v.item_id === it.id);
        const raw = (it.raw_data ?? {}) as Record<string, unknown>;
        const paciente =
          (it.patient_name as string | null) ??
          ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
          "—";
        return (
          <Card key={it.id} className="shadow-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-info" />
                <span className="text-sm font-medium truncate">{paciente}</span>
                <span className="text-xs text-muted-foreground">· {it.doctor_name}</span>
                {lastVersion && (
                  <span className="text-[10px] text-muted-foreground ml-auto">v{lastVersion.version}</span>
                )}
              </div>
              {f.matched_rules && f.matched_rules.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Regras aplicadas:{" "}
                  <span className="text-foreground">{f.matched_rules.join(", ")}</span>
                </div>
              )}
              {f.calculation_explanation && (
                <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">
                  {f.calculation_explanation}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}