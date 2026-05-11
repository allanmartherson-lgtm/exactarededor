import * as React from "react"
import { cn } from "@/lib/utils"

interface SafeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  headerColor?: string
  badge?: React.ReactNode
}

/**
 * SafeCard Component
 * Encapsula um card com regras sistêmicas de quebra de texto para evitar overflow e truncamento.
 * 
 * Regras aplicadas:
 * - overflow-hidden no container (para manter bordas arredondadas e clips)
 * - min-w-0 nos filhos do grid/flex (causa #1 de overflow em flexbox)
 * - break-words e whitespace-normal em textos para garantir quebra automática
 */
export const SafeCard = React.forwardRef<HTMLDivElement, SafeCardProps>(
  ({ className, children, headerColor, badge, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden min-w-0 flex flex-col relative",
          className
        )}
        {...props}
      >
        {headerColor && (
          <div 
            className="h-1.5 w-full shrink-0" 
            style={{ backgroundColor: headerColor }}
          />
        )}
        {badge && (
          <div className="absolute top-0 right-0 z-10">
            {badge}
          </div>
        )}
        <div className="p-3 break-words whitespace-normal overflow-wrap-anywhere flex-1 min-w-0">
          {children}
        </div>
      </div>
    )
  }
)

SafeCard.displayName = "SafeCard"
