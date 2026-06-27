/**
 * Grid de itens para pagamentos do modo MANUAL.
 *
 * Modo manual = analista lançou linha a linha (médico/empresa/valor já
 * fechados, vindos de planilha externa). NÃO existe regra aplicada, TUSS,
 * paciente, divergência ou alerta assistencial — então este grid é
 * deliberadamente enxuto, diferente do ItemsDataGrid usado em análise/
 * confecção.
 *
 * Colunas: Médico · Empresa · Especialidade · Valor · Observação · Anexo.
 */
import { useEffect, useState } from "react";
import { Paperclip, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/financialStats";
import { cn } from "@/lib/utils";

export type ManualGridItem = {
  id: string;
  doctor_name?: string | null;
  company_name?: string | null;
  specialty?: string | null;
  manual_note?: string | null;
  gross_amount?: number | null;
  manual_source_attachment_path?: string | null;
};

interface Props {
  items: ManualGridItem[];
  /** Botão opcional no header (ex.: "Adicionar item manual"). */
  headerAction?: React.ReactNode;
}

/** Abre o anexo do item via signed URL do bucket `payment-manual-sources`. */
function AttachmentLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const name = path.split("/").pop() ?? "anexo";
  const open = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("payment-manual-sources")
      .createSignedUrl(path, 60 * 10);
    setLoading(false);
    if (error || !data?.signedUrl) return;
    window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={open}
      disabled={loading}
      className="h-7 px-2 text-xs gap-1.5 max-w-[180px]"
      title={name}
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </Button>
  );
}

export function ManualItemsGrid({ items, headerAction }: Props) {
  const total = items.reduce((acc, it) => acc + (Number(it.gross_amount) || 0), 0);
  const withAttachment = items.filter((i) => !!i.manual_source_attachment_path).length;

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Itens lançados manualmente
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {items.length} {items.length === 1 ? "linha" : "linhas"} ·{" "}
              {withAttachment > 0
                ? `${withAttachment} com anexo individual`
                : "anexo individual: nenhum"}
              . Modo manual — sem regra, sem TUSS, sem divergência de cálculo.
            </p>
          </div>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs uppercase tracking-wide">Médico</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Empresa</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Especialidade</TableHead>
                <TableHead className="text-xs uppercase tracking-wide text-right">Valor</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Observação</TableHead>
                <TableHead className="text-xs uppercase tracking-wide">Anexo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Nenhum item lançado.
                  </TableCell>
                </TableRow>
              )}
              {items.map((it) => (
                <TableRow key={it.id} className="align-top">
                  <TableCell className="font-medium text-sm">
                    {it.doctor_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {it.company_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {it.specialty ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={cn("text-sm text-right tabular-nums font-medium")}>
                    {formatBRL(Number(it.gross_amount) || 0)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                    {it.manual_note ? (
                      <span className="whitespace-pre-wrap break-words">{it.manual_note}</span>
                    ) : (
                      <span className="opacity-60">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {it.manual_source_attachment_path ? (
                      <AttachmentLink path={it.manual_source_attachment_path} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {items.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-xs uppercase tracking-wide font-medium">
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatBRL(total)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default ManualItemsGrid;
