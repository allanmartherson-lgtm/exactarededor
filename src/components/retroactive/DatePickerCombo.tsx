import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseYmdLocal } from "@/lib/dateUtils";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import * as React from "react";

export function DatePickerCombo({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseYmdLocal(value) : undefined;
  return (
    <div className="flex gap-1">
      <DateInput value={value} onChange={onChange} className="flex-1" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Abrir calendário">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={selected}
            onSelect={(d) => {
              if (d) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                onChange(`${y}-${m}-${dd}`);
              } else {
                onChange("");
              }
              setOpen(false);
            }}
            initialFocus
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
