import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
type Contrast = "normal" | "high";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  contrast: Contrast;
  toggleContrast: () => void;
  setContrast: (c: Contrast) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "exacta-theme";
const CONTRAST_STORAGE_KEY = "exacta-contrast";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialContrast(): Contrast {
  if (typeof window === "undefined") return "normal";
  const stored = window.localStorage.getItem(CONTRAST_STORAGE_KEY) as Contrast | null;
  if (stored === "normal" || stored === "high") return stored;
  return "normal";
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [contrast, setContrastState] = useState<Contrast>(getInitialContrast);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("contrast-high", contrast === "high");
    window.localStorage.setItem(CONTRAST_STORAGE_KEY, contrast);
  }, [contrast]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  const setContrast = (c: Contrast) => setContrastState(c);
  const toggleContrast = () => setContrastState((c) => (c === "high" ? "normal" : "high"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, contrast, toggleContrast, setContrast }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
