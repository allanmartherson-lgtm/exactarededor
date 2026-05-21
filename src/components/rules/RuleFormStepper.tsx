import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

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
  steps,
  onSubmit,
  onCancel,
  isEditing,
  saving,
  summaryBanner,
  syncErrorBanner,
}: RuleFormStepperProps) {
  const [activeStep, setActiveStep] = useState(0);

  const totalErrors = useMemo(
    () => steps.reduce((acc, s) => acc + (s.errorCount ?? 0), 0),
    [steps]
  );

  const isLastStep = activeStep === steps.length - 1;
  const isFirstStep = activeStep === 0;

  const goNext = () => {
    if (!isLastStep) setActiveStep((s) => s + 1);
  };

  const goPrev = () => {
    if (!isFirstStep) setActiveStep((s) => s - 1);
  };

  return (
    <div className="flex flex-col h-full min-h-0" style={{ maxHeight: "calc(90vh - 80px)" }}>
      {/* Step indicators */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 0,
          padding: "0 0 20px",
          borderBottom: "1px solid hsl(var(--border))",
          marginBottom: 20,
          flexWrap: "wrap",
          rowGap: 12,
        }}
      >
        {steps.map((step, i) => {
          const isActive = i === activeStep;
          const isDone = i < activeStep;
          const hasError = (step.errorCount ?? 0) > 0;
          return (
            <div
              key={step.key}
              style={{
                display: "flex",
                alignItems: "center",
                flex: i < steps.length - 1 ? 1 : "none",
                minWidth: 120,
              }}
            >
              <button
                type="button"
                onClick={() => setActiveStep(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  fontFamily: "inherit",
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    transition: "all 0.15s",
                    background: hasError
                      ? "hsl(var(--destructive))"
                      : isDone
                      ? "#9A6B3A"
                      : isActive
                      ? "hsl(var(--primary))"
                      : "hsl(var(--muted))",
                    color:
                      hasError || isDone || isActive
                        ? "white"
                        : "hsl(var(--muted-foreground))",
                    boxShadow: isActive
                      ? "0 0 0 3px hsl(var(--primary) / 0.2)"
                      : "none",
                  }}
                >
                  {isDone && !hasError ? (
                    <Check size={14} strokeWidth={3} />
                  ) : hasError ? (
                    "!"
                  ) : (
                    i + 1
                  )}
                </div>
                <div style={{ textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      color: hasError
                        ? "hsl(var(--destructive))"
                        : isActive
                        ? "hsl(var(--foreground))"
                        : "hsl(var(--muted-foreground))",
                      lineHeight: 1.2,
                    }}
                  >
                    {step.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "hsl(var(--muted-foreground))",
                      marginTop: 1,
                    }}
                  >
                    {step.description}
                  </div>
                </div>
              </button>
              {i < steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: isDone ? "#9A6B3A" : "hsl(var(--border))",
                    margin: "0 12px",
                    opacity: isDone ? 0.5 : 0.4,
                    alignSelf: "flex-start",
                    marginTop: 15,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {(summaryBanner || syncErrorBanner) && (
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {syncErrorBanner}
          {summaryBanner}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingRight: 4,
          minHeight: 0,
        }}
      >
        <div style={{ animationDuration: "0.15s" }}>
          {steps[activeStep]?.content}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 20,
          marginTop: 16,
          borderTop: "1px solid hsl(var(--border))",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          {!isFirstStep && (
            <Button type="button" variant="outline" onClick={goPrev}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
        </div>

        {totalErrors > 0 && (
          <div
            style={{
              fontSize: 11,
              color: "hsl(var(--destructive))",
              background: "hsl(var(--destructive) / 0.08)",
              borderRadius: 6,
              padding: "4px 10px",
              fontWeight: 600,
            }}
          >
            {totalErrors} campo{totalErrors > 1 ? "s" : ""} com erro
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {!isLastStep && (
            <Button type="button" variant="outline" onClick={goNext}>
              Próximo <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          <Button
            type="button"
            onClick={onSubmit}
            disabled={saving}
            style={{
              background: "#9A6B3A",
              color: "white",
              border: "none",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Salvando…" : isEditing ? "Atualizar regra" : "Criar regra"}
          </Button>
        </div>
      </div>
    </div>
  );
}
