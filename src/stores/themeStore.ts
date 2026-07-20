import { create } from 'zustand';
import { Theme, themes, ThemeColors } from '../themes/themeDefinitions';

const STORAGE_KEY = 'theme';
const ACCENT_KEY = 'custom-accent';

// ---- Helpers ----

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function generateAccentVariants(hex: string): { accent: string; accentHover: string; accentLight: string; accentDark: string } {
  const { h, s, l } = hexToHSL(hex);
  return {
    accent: `hsl(${h}, ${s}%, ${l}%)`,
    accentHover: `hsl(${h}, ${s}%, ${Math.max(l - 5, 0)}%)`,
    accentLight: `hsl(${h}, ${Math.min(s + 10, 100)}%, ${Math.min(l + 15, 95)}%)`,
    accentDark: `hsl(${h}, ${s}%, ${Math.max(l - 15, 0)}%)`,
  };
}

function resolveSystemTheme(): Theme {
  try {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? themes[0] : themes[0]; // always dark for this app
  } catch {
    return themes[0];
  }
}

function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'purple';
  } catch {
    return 'purple';
  }
}

function loadCustomAccent(): string | null {
  try {
    return localStorage.getItem(ACCENT_KEY);
  } catch {
    return null;
  }
}

function applyTheme(colors: ThemeColors) {
  const root = document.documentElement;
  const c = colors;

  // Add transitioning class
  root.classList.add('theme-transitioning');

  root.style.setProperty('--color-bg', c.bg);
  root.style.setProperty('--color-bg-secondary', c.bgSecondary);
  root.style.setProperty('--color-bg-tertiary', c.bgTertiary);
  root.style.setProperty('--color-surface', c.surface);
  root.style.setProperty('--color-surface-hover', c.surfaceHover);
  root.style.setProperty('--color-surface-active', c.surfaceActive);
  root.style.setProperty('--color-text', c.text);
  root.style.setProperty('--color-text-secondary', c.textSecondary);
  root.style.setProperty('--color-text-muted', c.textMuted);
  root.style.setProperty('--color-accent', c.accent);
  root.style.setProperty('--color-accent-hover', c.accentHover);
  root.style.setProperty('--color-accent-light', c.accentLight);
  root.style.setProperty('--color-accent-dark', c.accentDark);
  root.style.setProperty('--color-border', c.border);
  root.style.setProperty('--color-border-hover', c.borderHover);
  root.style.setProperty('--color-border-accent', c.borderAccent);
  root.style.setProperty('--color-glass-bg', c.glassBg);
  root.style.setProperty('--color-glass-border', c.glassBorder);
  root.style.setProperty('--color-success', c.success);
  root.style.setProperty('--color-warning', c.warning);
  root.style.setProperty('--color-error', c.error);
  root.style.setProperty('--color-info', c.info);
  root.style.setProperty('--color-player-bg', c.playerBg);
  root.style.setProperty('--color-sidebar-bg', c.sidebarBg);
  root.style.setProperty('--color-shadow', c.shadow);
  root.style.setProperty('--color-shadow-accent', c.shadowAccent);

  // body background
  document.body.style.background = c.bg;
  document.body.style.color = c.text;

  // Remove transitioning class after animation
  setTimeout(() => root.classList.remove('theme-transitioning'), 400);
}

// ---- Store ----

interface ThemeStore {
  themeId: string;
  customAccent: string | null;
  isSystem: boolean;

  setTheme: (id: string) => void;
  setCustomAccent: (hex: string) => void;
  clearCustomAccent: () => void;
  getActiveColors: () => ThemeColors;
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initialId = loadThemeId();
  const initialAccent = loadCustomAccent();

  return {
    themeId: initialId,
    customAccent: initialAccent,
    isSystem: initialId === 'system',

    setTheme: (id) => {
      localStorage.setItem(STORAGE_KEY, id);
      set({ themeId: id, isSystem: id === 'system' });

      const theme = id === 'system' ? resolveSystemTheme() : themes.find((t: Theme) => t.id === id);
      if (!theme) return;

      const colors = { ...theme.colors };
      if (get().customAccent) {
        const accentVariants = generateAccentVariants(get().customAccent!);
        Object.assign(colors, accentVariants);
        // Update glass border to use accent
        colors.borderAccent = accentVariants.accent.replace('hsl', 'hsla').replace(')', ', 0.3)');
      }
      applyTheme(colors);
    },

    setCustomAccent: (hex) => {
      localStorage.setItem(ACCENT_KEY, hex);
      set({ customAccent: hex });
      // Re-apply current theme with new accent
      get().setTheme(get().themeId);
    },

    clearCustomAccent: () => {
      localStorage.removeItem(ACCENT_KEY);
      set({ customAccent: null });
      get().setTheme(get().themeId);
    },

    getActiveColors: (): ThemeColors => {
      const { themeId, customAccent } = get();
      const theme = themeId === 'system' ? resolveSystemTheme() : themes.find((t: Theme) => t.id === themeId) || themes[0];
      const colors = { ...theme.colors };
      if (customAccent) {
        const accentVariants = generateAccentVariants(customAccent);
        Object.assign(colors, accentVariants);
        colors.borderAccent = accentVariants.accent.replace('hsl', 'hsla').replace(')', ', 0.3)');
      }
      return colors;
    },
  };
});

// Apply initial theme on load — wrapped in try/catch for Capacitor WebView
try {
  const initialId = loadThemeId();
  const initialAccent = loadCustomAccent();
  const initialTheme = initialId === 'system' ? resolveSystemTheme() : themes.find((t: Theme) => t.id === initialId) || themes[0];
  const initialColors = { ...initialTheme.colors };
  if (initialAccent) {
    const accentVariants = generateAccentVariants(initialAccent);
    Object.assign(initialColors, accentVariants);
    initialColors.borderAccent = accentVariants.accent.replace('hsl', 'hsla').replace(')', ', 0.3)');
  }

  if (typeof document !== 'undefined' && typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      try { applyTheme(initialColors); } catch {}
    });
  }
} catch (e) {
  console.warn('[ThemeStore] Initial theme apply failed:', e);
}
