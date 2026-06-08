import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { XCircle } from "lucide-react";
import { reasonLabel } from "@/lib/cancelledPayments";

interface Props {
  reason: string | null;
  note?: string | null;
  cancelledAt?: string | null;
  cancelledByName?: string | null;
}

export default function CancelledBadge({ reason, note, cancelledAt, cancelledByName }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5">
          <XCircle className="h-3 w-3 mr-1" />
          Cancelado · {reasonLabel(reason)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="text-xs space-y-1">
          {cancelledByName && <div><strong>Por:</strong> {cancelledByName}</div>}
          {cancelledAt && (
            <div><strong>Em:</strong> {new Date(cancelledAt).toLocaleString("pt-BR")}</div>
          )}
          {note && <div className="border-t pt-1 mt-1 italic">{note}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
