import { useRef, type ReactNode } from "react";

/**
 * Botão primário CURA para envio de formulários.
 *
 * CuraButton vive dentro do shadow DOM e não dispara `submit` nativo. Para
 * preservar o fluxo Enter → submit + validação Zod dos formulários existentes,
 * renderizamos um <button type="submit" hidden> irmão e delegamos o clique do
 * cura-button para `form.requestSubmit()` — que aciona `onSubmit` normalmente.
 *
 * Uso:
 *   <form onSubmit={handleSubmit}>
 *     ...campos
 *     <CuraSubmitButton disabled={saving}>{saving ? "Salvando…" : "Salvar"}</CuraSubmitButton>
 *   </form>
 */
export function CuraSubmitButton({
  children,
  disabled,
  loading,
  className,
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  // Ref no submit oculto — usado tanto para acionar a submissão via requestSubmit
  // (o form pai é o `form` do próprio button) quanto para preservar comportamento
  // padrão de Enter dentro dos inputs do formulário.
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (disabled || loading) return;
    const btn = hiddenSubmitRef.current;
    if (!btn) return;
    const form = btn.form;
    if (form?.requestSubmit) form.requestSubmit(btn);
    else btn.click();
  };

  return (
    <div className={className ?? "w-full"}>
      <cura-button
        color="primary"
        expand="block"
        onClick={handleClick}
        disabled={disabled || loading || undefined}
        aria-disabled={disabled || loading || undefined}
        style={{ display: "block", width: "100%" }}
      >
        {children}
      </cura-button>
      {/* Submit oculto para acionar validação/onSubmit do form pai. */}
      <button
        ref={hiddenSubmitRef}
        type="submit"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}
      />
    </div>
  );
}
