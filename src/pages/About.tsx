import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import type { SystemRelease } from "@/hooks/useSystemVersion";

const TYPE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  major: "default",
  minor: "secondary",
  patch: "outline",
  hotfix: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function About() {
  const [releases, setReleases] = useState<SystemRelease[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("system_releases" as never)
        .select("*")
        .eq("published", true)
        .order("released_at", { ascending: false })
        .limit(20);
      setReleases((data as SystemRelease[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const current = releases.find((r) => r.is_current);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sobre o Exacta"
        description="Versão atual, novidades e histórico de releases."
      />

      {current && (
        <Card className="p-6 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-sm text-muted-foreground">Versão atual</span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-3xl font-bold">v{current.version}</h2>
            <Badge variant={TYPE_VARIANT[current.release_type] ?? "outline"}>
              {current.release_type}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Publicada em {formatDate(current.released_at)}
            </span>
          </div>
          <p className="mt-3 text-lg font-medium">{current.title}</p>
        </Card>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-3">Histórico de releases</h3>
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <div className="space-y-3">
          {releases.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-baseline gap-3 flex-wrap mb-2">
                <span className="font-mono text-lg font-semibold">v{r.version}</span>
                <Badge variant={TYPE_VARIANT[r.release_type] ?? "outline"} className="text-xs">
                  {r.release_type}
                </Badge>
                {r.is_current && <Badge variant="default" className="text-xs">Atual</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{formatDate(r.released_at)}</span>
              </div>
              <p className="font-medium mb-2">{r.title}</p>
              <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground leading-relaxed">
                {r.changelog}
              </pre>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
