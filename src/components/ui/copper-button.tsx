import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * CopperButton — botão padrão MedPay na cor copper (#9A6B3A).
 *
 * Encapsula `variant="copper"` num componente dedicado para evitar que
 * outros lugares sobrescrevam o variant ou apliquem `style` inline ad-hoc.
 * Use sempre que precisar de um CTA primário "copper".
 */
export type CopperButtonProps = Omit<ButtonProps, "variant">;

export const CopperButton = React.forwardRef<HTMLButtonElement, CopperButtonProps>(
  ({ className, type = "button", ...props }, ref) => (
    <Button ref={ref} variant="copper" type={type} className={cn(className)} {...props} />
  ),
);
CopperButton.displayName = "CopperButton";

export default CopperButton;
