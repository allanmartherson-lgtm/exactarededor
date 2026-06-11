import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
export type ContrastLevel = 1 | 2 | 3 | 4 | 5;
export type FontScale = "compact" | "normal" | "large" | "xlarge";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  contrastLevel: ContrastLevel;
  setContrastLevel: (n: ContrastLevel) => void;
  /** Atalho boolean p/ o menu de acessibilidade (on = nível 5, off = nível 3). */
  highContrast: boolean;
  setHighContrast: (v: boolean) => void;
  fontScale: FontScale;
  setFontScale: (s: FontScale) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "exacta-theme";
const CONTRAST_STORAGE_KEY = "exacta-contrast-level";
const FONT_SCALE_STORAGE_KEY = "exacta-font-scale";
const DEFAULT_CONTRAST: ContrastLevel = 3;
const DEFAULT_FONT_SCALE: FontScale = "normal";

export const FONT_SCALE_PX: Record<FontScale, number> = {
  compact: 14.4, // 90%
  normal: 16,    // 100%
  large: 18.4,   // 115%
  xlarge: 20.8,  // 130%
};

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialContrast(): ContrastLevel {
  if (typeof window === "undefined") return DEFAULT_CONTRAST;
  const raw = window.localStorage.getItem(CONTRAST_STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  if (n >= 1 && n <= 5 && Number.isInteger(n)) return n as ContrastLevel;
  const legacy = window.localStorage.getItem("exacta-contrast");
  if (legacy === "high") return 5;
  return DEFAULT_CONTRAST;
}

function getInitialFontScale(): FontScale {
  if (typeof window === "undefined") return DEFAULT_FONT_SCALE;
  const raw = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY) as FontScale | null;
  if (raw === "compact" || raw === "normal" || raw === "large" || raw === "xlarge") return raw;
  return DEFAULT_FONT_SCALE;
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [contrastLevel, setContrastLevelState] = useState<ContrastLevel>(getInitialContrast);
  const [fontScale, setFontScaleState] = useState<FontScale>(getInitialFontScale);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-contrast", String(contrastLevel));
    root.classList.toggle("high-contrast", contrastLevel >= 5);
    window.localStorage.setItem(CONTRAST_STORAGE_KEY, String(contrastLevel));
  }, [contrastLevel]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${FONT_SCALE_PX[fontScale] ?? 16}px`;
    root.dataset.fontScale = fontScale;
    window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, fontScale);
  }, [fontScale]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  const setContrastLevel = (n: ContrastLevel) => setContrastLevelState(n);
  const setHighContrast = (v: boolean) => setContrastLevelState(v ? 5 : 3);
  const setFontScale = (s: FontScale) => setFontScaleState(s);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        contrastLevel,
        setContrastLevel,
        highContrast: contrastLevel >= 5,
        setHighContrast,
        fontScale,
        setFontScale,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
