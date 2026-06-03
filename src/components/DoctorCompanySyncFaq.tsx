import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

/**
 * FAQ curto sobre sincronização Médico ↔ PJ.
 *
 * Usado tanto na página de Médicos quanto no cadastro da PJ
 * (CompanyDoctorsSection) para explicar o que é mantido em sincronia
 * em tempo real entre as duas telas.
 */
export function DoctorCompanySyncFaq({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "border border-border rounded-md bg-muted/30" : "border border-border rounded-md bg-muted/30 p-1"}>
      <Accordion type="single" collapsible>
        <AccordionItem value="faq" className="border-0">
          <AccordionTrigger className={compact ? "px-3 py-2 text-xs hover:no-underline" : "px-3 py-2 text-sm hover:no-underline"}>
            <span className="flex items-center gap-2">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              Como funciona a sincronização Médico ↔ PJ?
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <dl className={`space-y-3 ${compact ? "text-[11px]" : "text-xs"} leading-relaxed text-muted-foreground`}>
              <div>
                <dt className="font-semibold text-foreground">O que é sincronizado?</dt>
                <dd>
                  Toda criação, alteração ou encerramento de vínculo médico ↔ PJ aparece automaticamente
                  nas duas telas — cadastro do médico e cadastro da PJ — sem precisar recarregar.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">E as datas de vigência?</dt>
                <dd>
                  <strong>Início</strong> e <strong>fim</strong> do vínculo são compartilhados. Encerramentos com
                  motivo (<em>troca de PJ</em>, <em>desligamento</em> etc.) também são refletidos em ambos os lados.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">O histórico fica preservado?</dt>
                <dd>
                  Sim. Vínculos encerrados não são apagados — ficam registrados com data de início, data de fim e
                  motivo. Isso garante rastreabilidade de glosas e pagamentos antigos para a PJ correta da época.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Posso ter dois vínculos ao mesmo tempo?</dt>
                <dd>
                  Não. O sistema impede sobreposição de vigência. Para trocar de PJ, o vínculo anterior é encerrado
                  hoje e o novo começa no dia seguinte — o pagamento sempre prevalece sobre o cadastro.
                </dd>
              </div>
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
