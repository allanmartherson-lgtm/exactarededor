import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Download, Link2, Plus, Loader2, AlertTriangle } from "lucide-react";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";

interface UnregisteredItem {
  company_name: string;
  items_count: number;
  gross_total: number;
  sample_doctor: string | null;
}

export function UnregisteredCompaniesPanel({
  paymentId,
  onChanged,
}: {
  paymentId: string;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<UnregisteredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<CompanyOption | null>(null);
  const [newName, setNewName] = useState("");
  const [newDoc, setNewDoc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    // Busca todos os itens sem company_id (paginado em chunks de 1000)
    const all: any[] = [];
    let from = 0;
    const PAGE = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("payment_items")
        .select("company_name, gross_amount, doctor_name")
        .eq("payment_id", paymentId)
        .is("company_id", null)
        .range(from, from + PAGE - 1);
      if (error) break;
      all.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const grouped = new Map<string, UnregisteredItem>();
    for (const it of all) {
      const name = (it.company_name ?? "").trim() || "Sem empresa";
      const cur = grouped.get(name) ?? {
        company_name: name,
        items_count: 0,
        gross_total: 0,
        sample_doctor: null,
      };
      cur.items_count++;
      cur.gross_total += Number(it.gross_amount ?? 0);
      if (!cur.sample_doctor) cur.sample_doctor = it.doctor_name ?? null;
      grouped.set(name, cur);
    }
    setItems([...grouped.values()].sort((a, b) => b.gross_total - a.gross_total));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const totalItems = useMemo(() => items.reduce((s, x) => s + x.items_count, 0), [items]);
  const totalValue = useMemo(() => items.reduce((s, x) => s + x.gross_total, 0), [items]);

  const downloadCsv = () => {
    const header = "empresa_nao_cadastrada;qtd_itens;valor_bruto_total;medico_amostra";
    const lines = items.map(
      (i) =>
        `"${i.company_name.replace(/"/g, '""')}";${i.items_count};${i.gross_total
          .toFixed(2)
          .replace(".", ",")};"${(i.sample_doctor ?? "").replace(/"/g, '""')}"`,
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `empresas-nao-cadastradas-${paymentId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const linkToExisting = async (rawName: string) => {
    if (!picked) return;
    setBusy(true);
    try {
      // Adiciona o nome bruto como alias
      const { data: comp } = await supabase
        .from("companies")
        .select("aliases")
        .eq("id", picked.id)
        .maybeSingle();
      const aliases = new Set([...(comp?.aliases ?? [])]);
      if (rawName && rawName !== "Sem empresa" && !aliases.has(rawName)) aliases.add(rawName);
      await supabase.from("companies").update({ aliases: [...aliases] }).eq("id", picked.id);

      // Atualiza todos os itens dessa empresa no lote
      const updateQuery = supabase
        .from("payment_items")
        .update({ company_id: picked.id, company_name: picked.name })
        .eq("payment_id", paymentId)
        .is("company_id", null);
      if (rawName === "Sem empresa") {
        await updateQuery.is("company_name", null);
      } else {
        await updateQuery.eq("company_name", rawName);
      }

      toast.success(`Vinculado a ${picked.name}. Reanalisando empresa…`);

      // Reanalisa só essa empresa (agora com o nome novo)
      await supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: paymentId, only_companies: [picked.name] },
      });

      setLinkOpen(null);
      setPicked(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async (rawName: string) => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    setBusy(true);
    try {
      const aliases = rawName && rawName !== "Sem empresa" && rawName !== name ? [rawName] : [];
      const { data: created, error } = await supabase
        .from("companies")
        .insert({ name, document: newDoc.trim() || null, aliases })
        .select("id, name")
        .single();
      if (error) throw error;

      const updateQuery = supabase
        .from("payment_items")
        .update({ company_id: created.id, company_name: created.name })
        .eq("payment_id", paymentId)
        .is("company_id", null);
      if (rawName === "Sem empresa") {
        await updateQuery.is("company_name", null);
      } else {
        await updateQuery.eq("company_name", rawName);
      }

      toast.success(`Empresa "${created.name}" criada e vinculada. Reanalisando…`);

      await supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: paymentId, only_companies: [created.name] },
      });

      setCreateOpen(null);
      setNewName("");
      setNewDoc("");
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando empresas não cadastradas…
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <CardTitle className="text-base">
              Empresas não cadastradas no lote
            </CardTitle>
            <Badge variant="outline">
              {items.length} empresa(s) · {totalItems} item(ns) · {formatCurrency(totalValue)}
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={downloadCsv}>
            <Download className="h-4 w-4 mr-2" /> Baixar CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Estes itens entraram no lote mas não foram vinculados a nenhuma empresa cadastrada — sem
          empresa o motor não consegue aplicar regras por PJ. Vincule a uma empresa existente ou
          cadastre uma nova.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it) => (
          <div
            key={it.company_name}
            className="flex items-center justify-between gap-3 p-3 rounded-md border border-border/50 bg-card"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{it.company_name}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {it.items_count} item(ns) · {formatCurrency(it.gross_total)}
                {it.sample_doctor && ` · ex.: ${it.sample_doctor}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setLinkOpen(it.company_name)}>
                <Link2 className="h-3.5 w-3.5 mr-1" /> Vincular
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setNewName(it.company_name === "Sem empresa" ? "" : it.company_name);
                  setCreateOpen(it.company_name);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!linkOpen} onOpenChange={(o) => !o && setLinkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular "{linkOpen}" a uma empresa existente</DialogTitle>
          </DialogHeader>
          <CompanyCombobox value={picked} onChange={setPicked} placeholder="Buscar empresa..." />
          <p className="text-xs text-muted-foreground">
            O nome do arquivo será salvo como apelido para reconhecer automaticamente em próximos
            uploads.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => linkOpen && linkToExisting(linkOpen)} disabled={!picked || busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Vincular e reanalisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createOpen} onOpenChange={(o) => !o && setCreateOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar nova empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>CNPJ (opcional)</Label>
              <Input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => createOpen && createAndLink(createOpen)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar e vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
