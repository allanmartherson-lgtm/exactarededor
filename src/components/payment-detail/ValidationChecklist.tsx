import { useEffect, useState, useCallback } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface ChecklistItem {
  text: string;
  priority: "alta" | "media" | "baixa";
  category: string;
}

interface Props {
  companyName: string;
  paymentId: string;
}

const PRIORITY_VARIANT: Record<ChecklistItem["priority"], "destructive" | "warning" | "muted"> = {
  alta: "destructive",
  media: "warning",
  baixa: "muted",
};

const PRIORITY_LABEL: Record<ChecklistItem["priority"], string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export function ValidationChecklist({ companyName, paymentId }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [errored, setErrored] = useState(false);
  const [cached, setCached] = useState<boolean>(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setErrored(false);
    try {
      const { data, error } = await supabase.functions.invoke("company-checklist", {
        body: { company_name: companyName, payment_id: paymentId, force_refresh: force },
      });
      if (error || !data?.ok) {
        setErrored(true);
        setItems([]);
      } else {
        setItems(Array.isArray(data.checklist) ? data.checklist : []);
        setCached(Boolean(data.cached));
      }
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyName, paymentId]);

  useEffect(() => { load(false); }, [load]);

  if (loading) {
    return (
      <Card className="border-violet-200 bg-violet-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-violet-600" />
            Checklist de Validação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (errored || items.length === 0) return null;

  const toggle = (idx: number) => {
    const next = new Set(checked);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    setChecked(next);
  };

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-violet-600" />
          Checklist de Validação
          {cached && (
            <Badge variant="muted" className="text-[10px] font-normal">em cache</Badge>
          )}
          <span className="text-xs font-normal text-muted-foreground ml-auto">
            {checked.size}/{items.length} conferidos
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => load(true)}
            disabled={refreshing}
            aria-label="Atualizar checklist"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, idx) => {
          const isChecked = checked.has(idx);
          return (
            <div key={idx} className="flex items-start gap-2 p-2 rounded border bg-background">
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggle(idx)}
                className="mt-0.5"
                aria-label={item.text}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <span className={`text-xs flex-1 ${isChecked ? "line-through text-muted-foreground" : ""}`}>
                    {item.text}
                  </span>
                  <Badge variant={PRIORITY_VARIANT[item.priority]} className="text-[10px] shrink-0">
                    {PRIORITY_LABEL[item.priority]}
                  </Badge>
                </div>
                {item.category && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">{item.category}</div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
