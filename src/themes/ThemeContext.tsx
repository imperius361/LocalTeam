import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeName = 'obsidian' | 'pixel';

interface ThemeContextValue {
  theme: ThemeName | null;
  setTheme: (t: ThemeName) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Read from localStorage on mount
  useEffect(() => {
    const storedTheme = localStorage.getItem('localteam.theme');
    const validTheme = storedTheme === 'obsidian' || storedTheme === 'pixel' ? storedTheme : null;
    setThemeState(validTheme);
    if (validTheme) {
      document.documentElement.setAttribute('data-theme', validTheme);
    }
    setIsHydrated(true);
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem('localteam.theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };

  const resetTheme = () => {
    setThemeState(null);
    localStorage.removeItem('localteam.theme');
    document.documentElement.removeAttribute('data-theme');
  };

  const value: ThemeContextValue = {
    theme,
    setTheme,
    resetTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {isHydrated ? children : null}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
