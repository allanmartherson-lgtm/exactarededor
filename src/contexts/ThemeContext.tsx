import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
export type ContrastLevel = 1 | 2 | 3 | 4 | 5;

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  contrastLevel: ContrastLevel;
  setContrastLevel: (n: ContrastLevel) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "exacta-theme";
const CONTRAST_STORAGE_KEY = "exacta-contrast-level";
const DEFAULT_CONTRAST: ContrastLevel = 3;

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
  // legacy: boolean "high" key
  const legacy = window.localStorage.getItem("exacta-contrast");
  if (legacy === "high") return 5;
  return DEFAULT_CONTRAST;
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [contrastLevel, setContrastLevelState] = useState<ContrastLevel>(getInitialContrast);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-contrast", String(contrastLevel));
    window.localStorage.setItem(CONTRAST_STORAGE_KEY, String(contrastLevel));
  }, [contrastLevel]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  const setContrastLevel = (n: ContrastLevel) => setContrastLevelState(n);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, contrastLevel, setContrastLevel }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
