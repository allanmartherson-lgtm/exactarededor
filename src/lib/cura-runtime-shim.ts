type CuraInitOptions = {
  localAssetsPath?: string;
  theme?: string;
  customTheme?: Record<string, unknown>;
  onReady?: (api: unknown) => void;
};

const STYLE_ID = "exacta-cura-runtime-shim";

const injectFallbackStyles = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    cura-button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2.75rem;
      padding: 0 1rem;
      border-radius: var(--radius, 0.375rem);
      background: hsl(var(--primary));
      color: hsl(var(--primary-foreground));
      font: inherit;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      transition: opacity 160ms ease, filter 160ms ease;
    }
    cura-button[expand="block"] { width: 100%; }
    cura-button[disabled], cura-button[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.55;
      pointer-events: none;
    }
    cura-button:not([disabled]):not([aria-disabled="true"]):hover { filter: brightness(0.96); }
    cura-button:focus-visible {
      outline: 2px solid hsl(var(--ring));
      outline-offset: 2px;
    }
  `;
  doc.head.appendChild(style);
};

class CuraButtonFallback extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    if (!this.hasAttribute("tabindex")) this.setAttribute("tabindex", "0");
    this.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    this.removeEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || this.hasAttribute("disabled") || this.getAttribute("aria-disabled") === "true") return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.click();
    }
  };
}

class CuraIconFallback extends HTMLElement {}

export function CuraInit(options?: CuraInitOptions, w: Window = window) {
  injectFallbackStyles(w.document);
  options?.onReady?.({ fallback: true, localAssetsPath: options.localAssetsPath });
}

export async function defineCustomElements(win: Window = window) {
  injectFallbackStyles(win.document);

  if ("customElements" in win) {
    if (!win.customElements.get("cura-button")) {
      win.customElements.define("cura-button", CuraButtonFallback);
    }
    if (!win.customElements.get("cura-icon")) {
      win.customElements.define("cura-icon", CuraIconFallback);
    }
  }
}
