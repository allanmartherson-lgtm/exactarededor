import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Trash2, Search, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatCNPJ } from "@/lib/cnpj";
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
import { PageHeader } from "@/components/PageHeader";

interface Row {
  id: string;
  name: string;
  document: string | null;
  aliases: string[];
}

export default function CompanyAliases() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("companies")
      .select("id,name,document,aliases")
      .order("name");
    if (error) {
      toast.error("Erro ao carregar apelidos", { description: error.message });
      setLoading(false);
      return;
    }
    const filtered = (data ?? [])
      .map((c: any) => ({ ...c, aliases: c.aliases ?? [] }))
      .filter((c: Row) => c.aliases.length > 0);
    setRows(filtered);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const removeAlias = async (company: Row, alias: string) => {
    setBusy(`${company.id}:${alias}`);
    const next = company.aliases.filter((a) => a !== alias);
    const { error } = await supabase.from("companies").update({ aliases: next }).eq("id", company.id);
    setBusy(null);
    if (error) {
      toast.error("Falha ao remover", { description: error.message });
      return;
    }
    toast.success("Apelido removido", {
      description: `"${alias}" não será mais usado para identificar essa empresa.`,
    });
    setRows((prev) =>
      prev
        .map((r) => (r.id === company.id ? { ...r, aliases: next } : r))
        .filter((r) => r.aliases.length > 0),
    );
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.document ?? "").includes(term) ||
          r.aliases.some((a) => a.toLowerCase().includes(term)),
      )
    : rows;

  const totalAliases = visible.reduce((s, r) => s + r.aliases.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apelidos aprendidos"
        description="Revise os nomes (apelidos) que o sistema aprendeu a partir de nomes de arquivo ao criar lotes de pagamento. Remova qualquer apelido que tenha vinculado a empresa errada."
        icon={Sparkles}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Empresas com apelidos
            <Badge variant="secondary">{totalAliases}</Badge>
          </CardTitle>
          <CardDescription>
            Cada apelido abaixo faz o sistema sugerir automaticamente esta empresa quando o nome do
            arquivo de upload contém esse texto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por empresa, CNPJ ou apelido…"
            />
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum apelido aprendido ainda. Quando você corrigir manualmente a empresa sugerida ao
              criar um lote, o nome do arquivo será salvo aqui.
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((c) => (
                <div key={c.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      CNPJ {c.document ? formatCNPJ(c.document) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {c.aliases.map((a) => {
                      const key = `${c.id}:${a}`;
                      return (
                        <AlertDialog key={key}>
                          <AlertDialogTrigger asChild>
                            <Badge
                              variant="outline"
                              className="gap-1.5 pr-1.5 cursor-pointer hover:border-destructive hover:text-destructive transition-colors"
                            >
                              <span className="max-w-[280px] truncate">{a}</span>
                              {busy === key ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Badge>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover apelido?</AlertDialogTitle>
                              <AlertDialogDescription>
                                O apelido <strong>"{a}"</strong> não será mais usado para identificar{" "}
                                <strong>{c.name}</strong> em uploads futuros. Lotes já criados não são
                                afetados.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeAlias(c, a)}>
                                Remover
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              Atualizar lista
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
