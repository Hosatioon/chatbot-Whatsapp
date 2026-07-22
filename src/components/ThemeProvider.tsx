"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type TenantTheme = "light" | "dark" | "blue" | "pink" | "whatsapp";

interface ThemeContextValue {
  theme: TenantTheme;
  setTheme: (theme: TenantTheme) => Promise<void>;
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: async () => {},
  loading: false,
});

function applyTheme(theme: TenantTheme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<TenantTheme>("light");
  const [loading, setLoading] = useState(true);

  // Cargar tema del tenant al montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tenant/theme");
        if (!res.ok) return;
        const data = (await res.json()) as { theme: TenantTheme };
        if (!cancelled) {
          setThemeState(data.theme);
          applyTheme(data.theme);
        }
      } catch {
        /* ignore: usa default light */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback(async (next: TenantTheme) => {
    // Aplicar de inmediato (optimistic UI)
    applyTheme(next);
    setThemeState(next);
    try {
      await fetch("/api/tenant/theme", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
    } catch {
      /* si falla, no revertimos: el usuario verá el cambio local hasta refresh */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, loading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
