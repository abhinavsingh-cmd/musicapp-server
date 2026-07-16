import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type ThemeName = 'violet' | 'emerald' | 'rose' | 'amber' | 'blue' | 'cyan' | 'orange' | 'pink';

interface ThemeConfig {
  name: ThemeName;
  primary: string;
  secondary: string;
  accent: string;
  gradient: string;
}

const themes: Record<ThemeName, ThemeConfig> = {
  violet: { 
    name: 'violet', 
    primary: '#8b5cf6', 
    secondary: '#a78bfa', 
    accent: '#d946ef',
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 50%, #C4B5FD 100%)'
  },
  emerald: { 
    name: 'emerald', 
    primary: '#10b981', 
    secondary: '#34d399', 
    accent: '#06b6d4',
    gradient: 'linear-gradient(135deg, #10B981 0%, #34D399 50%, #6EE7B7 100%)'
  },
  rose: { 
    name: 'rose', 
    primary: '#f43f5e', 
    secondary: '#fb7185', 
    accent: '#f97316',
    gradient: 'linear-gradient(135deg, #F43F5E 0%, #FB7185 50%, #FDA4AF 100%)'
  },
  amber: { 
    name: 'amber', 
    primary: '#f59e0b', 
    secondary: '#fbbf24', 
    accent: '#ef4444',
    gradient: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 50%, #FDE68A 100%)'
  },
  blue: { 
    name: 'blue', 
    primary: '#3b82f6', 
    secondary: '#60a5fa', 
    accent: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 50%, #93C5FD 100%)'
  },
  cyan: { 
    name: 'cyan', 
    primary: '#06b6d4', 
    secondary: '#22d3ee', 
    accent: '#ec4899',
    gradient: 'linear-gradient(135deg, #06B6D4 0%, #22D3EE 50%, #67E8F9 100%)'
  },
  orange: { 
    name: 'orange', 
    primary: '#f97316', 
    secondary: '#fb923c', 
    accent: '#eab308',
    gradient: 'linear-gradient(135deg, #F97316 0%, #FB923C 50%, #FED7AA 100%)'
  },
  pink: { 
    name: 'pink', 
    primary: '#ec4899', 
    secondary: '#f472b6', 
    accent: '#06b6d4',
    gradient: 'linear-gradient(135deg, #EC4899 0%, #F472B6 50%, #F9A8D4 100%)'
  },
};

interface ThemeContextType {
  theme: ThemeName;
  config: ThemeConfig;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

function applyTheme(config: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty('--color-accent', config.primary);
  root.style.setProperty('--color-accent-hover', config.secondary);
  root.style.setProperty('--color-accent-light', config.secondary);
  root.style.setProperty('--color-accent-dark', config.primary);
  root.style.setProperty('--color-border-accent', `${config.primary}4d`);
  root.style.setProperty('--color-shadow-accent', `${config.primary}4d`);
  root.style.setProperty('--gradient-violet', config.gradient);
  root.style.setProperty('--gradient-fuchsia', config.gradient);
  root.style.setProperty('--light-angle', '135deg');
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('music-theme') as ThemeName) || 'violet';
    }
    return 'violet';
  });

  const config = useMemo(() => themes[theme], [theme]);

  useEffect(() => {
    applyTheme(config);
    localStorage.setItem('music-theme', theme);
  }, [theme, config]);

  const setTheme = useCallback((name: ThemeName) => setThemeState(name), []);

  const value = useMemo<ThemeContextType>(() => ({ theme, config, setTheme }), [theme, config, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export type { ThemeName, ThemeConfig };