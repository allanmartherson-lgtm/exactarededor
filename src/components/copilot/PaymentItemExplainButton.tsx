import { useState } from "react";
import { ZeevIcon } from "./ZeevIcon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopilotCard } from "./CopilotCard";

interface Props {
  item: Record<string, unknown>;
  candidateRules?: unknown[];
  itemStatus: string;
  size?: "sm" | "icon";
}

/**
 * Botão "Por que esse item?" para usar dentro de listas/grids de payment_items.
 * Abre um popover que chama o copiloto IA com o contexto do item.
 * Plugue no ItemsDataGrid, painéis de itens problemáticos, ou qualquer lista.
 */
export function PaymentItemExplainButton({ item, candidateRules = [], itemStatus, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size={size === "icon" ? "icon" : "sm"} className="h-7 text-xs">
          <ZeevIcon className="h-3 w-3 mr-1 text-primary" />
          {size === "icon" ? null : "Por quê?"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <CopilotCard
          task="explain_item_status"
          title="Por que esse item ficou assim?"
          triggerLabel="Analisar item com IA"
          context={{ item, candidate_rules: candidateRules, item_status: itemStatus }}
        />

      </PopoverContent>
    </Popover>
  );
}
