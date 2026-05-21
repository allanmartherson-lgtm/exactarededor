import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepperStep = {
  key: string;
  label: string;
  description: string;
  errorCount?: number;
  content: React.ReactNode;
};

interface RuleFormStepperProps {
  steps: StepperStep[];
  onSubmit: () => void;
  onCancel: () => void;
  isEditing: boolean;
  saving?: boolean;
  summaryBanner?: React.ReactNode;
  syncErrorBanner?: React.ReactNode;
}

export function RuleFormStepper({
  steps, onSubmit, onCancel, isEditing, saving, summaryBanner, syncErrorBanner,
}: RuleFormStepperProps) {
  const [activeStep, setActiveStep] = useState(0);

  const totalErrors = useMemo(
    () => steps.reduce((acc, s) => acc + (s.errorCount ?? 0), 0),
    [steps]
  );

  const isLastStep = activeStep === steps.length - 1;
  const isFirstStep = activeStep === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, maxHeight: "calc(90vh - 80px)" }}>

      {/* ── Step indicators ── */}
      <div style={{ display: "flex", alignItems: "stretch", marginBottom: 0, background: "hsl(var(--muted) / 0.5)", borderRadius: 10, padding: 4, gap: 2 }}>
        {steps.map((step, i) => {
          const isActive = i === activeStep;
          const isDone = i < activeStep;
          const hasError = (step.errorCount ?? 0) > 0;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => setActiveStep(i)}
              style={{
                flex: 1, display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                fontFamily: "inherit", transition: "all 0.15s",
                background: isActive ? "hsl(var(--primary) / 0.1)" : "transparent",
                boxShadow: isActive ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)" : "none",
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, transition: "all 0.15s",
                background: hasError ? "hsl(var(--destructive))"
                  : isDone ? "hsl(var(--primary))"
                  : isActive ? "hsl(var(--primary))"
                  : "hsl(var(--muted-foreground) / 0.2)",
                color: hasError || isDone || isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
              }}>
                {isDone && !hasError ? <Check size={13} strokeWidth={3} /> : hasError ? "!" : i + 1}
              </div>
              <div style={{ textAlign: "left", minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: isActive ? 700 : 500, lineHeight: 1.2,
                  color: hasError ? "hsl(var(--destructive))" : isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{step.label}</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, whiteSpace: "nowrap" }}>{step.description}</div>
              </div>
              {hasError && (
                <div style={{ marginLeft: "auto", background: "hsl(var(--destructive))", color: "white", borderRadius: 20, padding: "1px 6px", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                  {step.errorCount}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Banners ── */}
      {(summaryBanner || syncErrorBanner) && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {syncErrorBanner}
          {summaryBanner}
        </div>
      )}

      {/* ── Step content ── */}
      <div style={{
        flex: 1, overflowY: "auto", minHeight: 0, marginTop: 16,
        background: "hsl(var(--muted) / 0.25)", borderRadius: 10,
        border: "1px solid hsl(var(--border))", padding: "20px",
      }}>
        {steps[activeStep]?.content}
      </div>

      {/* ── Footer ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 16, marginTop: 12, gap: 12, flexShrink: 0,
        borderTop: "1px solid hsl(var(--border))",
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Button type="button" variant="ghost" onClick={onCancel} style={{ color: "hsl(var(--muted-foreground))" }}>
            Cancelar
          </Button>
          {!isFirstStep && (
            <Button type="button" variant="outline" onClick={() => setActiveStep(s => s - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
        </div>

        {totalErrors > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "hsl(var(--destructive))", background: "hsl(var(--destructive) / 0.08)", borderRadius: 6, padding: "5px 10px", fontWeight: 600 }}>
            <AlertCircle size={13} /> {totalErrors} campo{totalErrors > 1 ? "s" : ""} com erro
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          {!isLastStep && (
            <Button type="button" variant="outline" onClick={() => setActiveStep(s => s + 1)}>
              Próximo <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          <Button
            type="button" onClick={onSubmit} disabled={saving}
            style={{ opacity: saving ? 0.7 : 1, paddingLeft: 20, paddingRight: 20, fontWeight: 600 }}
          >
            {saving ? "Salvando…" : isEditing ? "Atualizar regra" : "Criar regra"}
          </Button>
        </div>
      </div>
    </div>
  );
}
