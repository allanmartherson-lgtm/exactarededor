/**
 * Botões de exportação (Word/Excel) do Cadastro de Acordos.
 * Disponíveis em qualquer etapa do fluxo — o modelo é montado sob demanda
 * pelo chamador (registro salvo ou rascunho em edição no wizard).
 */
import { useState } from "react";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  exportAgreementDocx,
  exportAgreementXlsx,
  type AgreementExportModel,
} from "@/lib/agreementExport";
import { exportAgreementPdf } from "@/lib/agreementDraftPdf";

interface Props {
  /** Monta o estado atual do acordo no formato de exportação. */
  getModel: () => Promise<AgreementExportModel> | AgreementExportModel;
  disabled?: boolean;
  /** Motivo exibido quando desabilitado (ex: dados mínimos ainda não preenchidos). */
  disabledHint?: string;
  size?: "sm" | "default";
}

export function AgreementExportButtons({ getModel, disabled, disabledHint, size = "sm" }: Props) {
  const [busy, setBusy] = useState<"docx" | "xlsx" | "pdf" | null>(null);

  const run = async (kind: "docx" | "xlsx" | "pdf") => {
    setBusy(kind);
    try {
      const model = await getModel();
      if (kind === "docx") await exportAgreementDocx(model);
      else if (kind === "pdf") await exportAgreementPdf(model);
      else exportAgreementXlsx(model);
    } catch (e) {
      toast.error("Não foi possível gerar o arquivo", {
        description: e instanceof Error ? e.message : "Tente novamente em instantes.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled || busy !== null}
        title={disabled ? disabledHint : "Exportar o acordo em Word (.docx)"}
        onClick={() => void run("docx")}
      >
        <FileDown className="h-4 w-4 mr-2" />
        {busy === "docx" ? "Gerando..." : "Exportar Word"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled || busy !== null}
        title={disabled ? disabledHint : "Exportar o acordo em Excel (.xlsx)"}
        onClick={() => void run("xlsx")}
      >
        <FileSpreadsheet className="h-4 w-4 mr-2" />
        {busy === "xlsx" ? "Gerando..." : "Exportar Excel"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled || busy !== null}
        title={disabled ? disabledHint : "Exportar o acordo em PDF (versão informativa)"}
        onClick={() => void run("pdf")}
      >
        <FileText className="h-4 w-4 mr-2" />
        {busy === "pdf" ? "Gerando..." : "Exportar PDF"}
      </Button>
    </>
  );
}
