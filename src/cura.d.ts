/**
 * Type declarations para o Design System CURA (@rededor/cura).
 *
 * O pacote traz Web Components (Stencil) sem tipos TS gerados para o entrypoint
 * `dist/esm/index.js`. Declaramos aqui as APIs que usamos: `CuraInit` no
 * bootstrap e `defineCustomElements` no loader. Também registramos o elemento
 * `<cura-icon>` no namespace JSX porque `cura-react` só cobre componentes
 * proxy — ícones institucionais são usados como custom element cru.
 */
declare module "@rededor/cura" {
  export interface CuraInitOptions {
    localAssetsPath?: string;
    theme?: string;
    customTheme?: Record<string, unknown>;
    onReady?: (api: unknown) => void;
  }
  export function CuraInit(options?: CuraInitOptions, w?: Window): void;
}

declare module "@rededor/cura/dist/loader" {
  export function defineCustomElements(win?: Window): Promise<void>;
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      "cura-icon": React.HTMLAttributes<HTMLElement> & {
        name: string;
        size?: number | string;
        color?: string;
      };
    }
  }
}
