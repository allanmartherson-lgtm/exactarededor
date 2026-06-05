import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, UserPlus, Link as LinkIcon, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  normalize,
  parseCrm,
  createDoctorAlias,
  createConvenioAlias,
  createSectorAlias,
  type DoctorRegistry,
  type ConvenioRegistry,
  type SectorRegistry,
} from "@/lib/registryLookup";
import { useAuth } from "@/contexts/AuthContext";

export type UnresolvedGroup = {
  kind: "doctor" | "convenio" | "sector";
  raw: string;
  count: number;
};

interface Props {
  unresolved: UnresolvedGroup[];
  doctorReg: DoctorRegistry;
  convenioReg: ConvenioRegistry;
  sectorReg: SectorRegistry;
  onResolved: () => Promise<void>;
}

const KIND_LABEL: Record<UnresolvedGroup["kind"], string> = {
  doctor: "Médico",
  convenio: "Convênio",
  sector: "Setor",
};

export function RegistryResolutionPanel({ unresolved, doctorReg, convenioReg, sectorReg, onResolved }: Props) {
  const counts = useMemo(() => {
    const c = { doctor: 0, convenio: 0, sector: 0 };
    for (const u of unresolved) c[u.kind] += 1;
    return c;
  }, [unresolved]);

  if (unresolved.length === 0) {
    return (
      <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900">
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Todos os cadastros foram reconhecidos</AlertTitle>
        <AlertDescription>
          Médicos, convênios e setores da planilha estão vinculados aos cadastros oficiais.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Resolução de cadastros
            </CardTitle>
            <CardDescription>
              {unresolved.length} valor{unresolved.length === 1 ? "" : "es"} da planilha não bate{unresolved.length === 1 ? "" : "m"} com
              o cadastro oficial. Vincule a um registro existente, crie um alias ou cadastre um novo antes de continuar.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {counts.doctor > 0 && <Badge variant="outline">{counts.doctor} médicos</Badge>}
            {counts.convenio > 0 && <Badge variant="outline">{counts.convenio} convênios</Badge>}
            {counts.sector > 0 && <Badge variant="outline">{counts.sector} setores</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {unresolved.map((u) => (
          <ResolutionRow
            key={`${u.kind}-${u.raw}`}
            group={u}
            doctorReg={doctorReg}
            convenioReg={convenioReg}
            sectorReg={sectorReg}
            onResolved={onResolved}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ResolutionRow({
  group,
  doctorReg,
  convenioReg,
  sectorReg,
  onResolved,
}: {
  group: UnresolvedGroup;
  doctorReg: DoctorRegistry;
  convenioReg: ConvenioRegistry;
  sectorReg: SectorRegistry;
  onResolved: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState(group.raw);
  const [newDoc, setNewDoc] = useState(""); // CRM | slug

  const candidates = useMemo(() => {
    const q = normalize(query || group.raw);
    if (group.kind === "doctor") {
      const seen = new Set<string>();
      const list: { label: string; value: string }[] = [];
      doctorReg.byAlias.forEach((d) => {
        if (seen.has(d.id)) return;
        const label = `${d.full_name}${d.crm ? ` — CRM ${d.crm}` : ""}`;
        if (normalize(label).includes(q)) {
          seen.add(d.id);
          list.push({ label, value: d.id });
        }
      });
      return list.slice(0, 8);
    }
    if (group.kind === "convenio") {
      const out: { label: string; value: string }[] = [];
      convenioReg.bySlug.forEach((c) => {
        if (normalize(c.name).includes(q) || c.slug.includes(q)) out.push({ label: c.name, value: c.slug });
      });
      return out.slice(0, 8);
    }
    const out: { label: string; value: string }[] = [];
    sectorReg.bySlug.forEach((s) => {
      if (normalize(s.name).includes(q) || s.slug.includes(q)) out.push({ label: s.name, value: s.slug });
    });
    return out.slice(0, 8);
  }, [group, query, doctorReg, convenioReg, sectorReg]);

  const linkAsAlias = async (target: string) => {
    setBusy(true);
    try {
      const aliasText = group.raw;
      let res;
      if (group.kind === "doctor") res = await createDoctorAlias(target, aliasText);
      else if (group.kind === "convenio") res = await createConvenioAlias(target, aliasText);
      else res = await createSectorAlias(target, aliasText);
      if (res.error) throw res.error;
      toast({ title: "Alias criado", description: `"${aliasText}" vinculado ao cadastro.` });
      await onResolved();
    } catch (e: any) {
      toast({ title: "Erro ao criar alias", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const createNew = async () => {
    setBusy(true);
    try {
      if (group.kind === "doctor") {
        if (!user) throw new Error("Sessão expirada");
        // Cria o médico SEMPRE como pendente de validação do administrador.
        // RLS permite ao analista inserir desde que pending_admin_review=true
        // e created_by_user_id=auth.uid(). Admin/diretor pode aprovar depois.
        const parsed = parseCrm(newDoc);
        const { data, error } = await supabase
          .from("doctors")
          .insert({
            full_name: newName.trim(),
            crm: parsed.number || "",
            crm_uf: parsed.uf || "",
            active: true,
            pending_admin_review: true,
            created_by_user_id: user.id,
            pending_review_note: `Cadastro provisório criado durante importação. Texto original na planilha: "${group.raw}".`,
          } as any)
          .select("id")
          .single();
        if (error || !data) throw error;
        await createDoctorAlias((data as any).id, group.raw);
        toast({
          title: "Médico cadastrado provisoriamente",
          description: "Aguarda validação do administrador antes do envio para validação do pagamento.",
        });
      } else if (group.kind === "convenio") {
        const slug = (newDoc.trim() || normalize(newName).replace(/\s+/g, "_")).slice(0, 64);
        const { error } = await supabase.from("convenios").insert({ slug, name: newName.trim(), active: true });
        if (error) throw error;
        await createConvenioAlias(slug, group.raw);
        toast({ title: "Cadastro criado", description: `${KIND_LABEL[group.kind]} cadastrado e vinculado.` });
      } else {
        const slug = (newDoc.trim() || normalize(newName).replace(/\s+/g, "_")).slice(0, 64);
        const { error } = await supabase.from("sectors").insert({ slug, name: newName.trim(), active: true });
        if (error) throw error;
        await createSectorAlias(slug, group.raw);
        toast({ title: "Cadastro criado", description: `${KIND_LABEL[group.kind]} cadastrado e vinculado.` });
      }
      setShowCreate(false);
      await onResolved();
    } catch (e: any) {
      toast({ title: "Erro ao cadastrar", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{KIND_LABEL[group.kind]}</Badge>
            <span className="font-medium truncate">{group.raw || "(vazio)"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{group.count} ocorrência{group.count === 1 ? "" : "s"} no lote</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)} disabled={busy}>
          <UserPlus className="h-4 w-4 mr-1" /> Cadastrar novo
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder={`Buscar ${KIND_LABEL[group.kind].toLowerCase()} no cadastro...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8"
        />
      </div>

      {candidates.length > 0 && (
        <div className="space-y-1">
          {candidates.map((c) => (
            <div key={c.value} className="flex items-center justify-between text-sm rounded-md border bg-background px-2 py-1.5">
              <span className="truncate">{c.label}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => linkAsAlias(c.value)}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><LinkIcon className="h-3 w-3 mr-1" />Vincular</>}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="rounded-md border bg-muted/40 p-2 space-y-2">
          <Input
            placeholder="Nome oficial"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8"
          />
          <Input
            placeholder={group.kind === "doctor" ? "CRM (opcional)" : "Slug (opcional, ex: bradesco_saude)"}
            value={newDoc}
            onChange={(e) => setNewDoc(e.target.value)}
            className="h-8"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)} disabled={busy}>Cancelar</Button>
            <Button size="sm" onClick={createNew} disabled={busy || !newName.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar e vincular"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
