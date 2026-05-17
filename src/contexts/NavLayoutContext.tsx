import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type NavLayout = "top" | "side";

const STORAGE_KEY = "nav-layout";

interface NavLayoutContextValue {
  layout: NavLayout;
  setLayout: (l: NavLayout) => void;
  toggleLayout: () => void;
}

const NavLayoutContext = createContext<NavLayoutContextValue | undefined>(undefined);

function getInitialLayout(): NavLayout {
  if (typeof window === "undefined") return "side";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "top" ? "top" : "side";
}

export const NavLayoutProvider = ({ children }: { children: ReactNode }) => {
  const [layout, setLayoutState] = useState<NavLayout>(getInitialLayout);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.navLayout = layout;
    window.localStorage.setItem(STORAGE_KEY, layout);
  }, [layout]);

  const setLayout = (l: NavLayout) => setLayoutState(l);
  const toggleLayout = () => setLayoutState((l) => (l === "top" ? "side" : "top"));

  return (
    <NavLayoutContext.Provider value={{ layout, setLayout, toggleLayout }}>
      {children}
    </NavLayoutContext.Provider>
  );
};

export const useNavLayout = () => {
  const ctx = useContext(NavLayoutContext);
  if (!ctx) throw new Error("useNavLayout must be used within NavLayoutProvider");
  return ctx;
};