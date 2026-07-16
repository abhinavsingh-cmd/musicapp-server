export interface ThemeColors {
  // Core
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;

  // Accent
  accent: string;
  accentHover: string;
  accentLight: string;
  accentDark: string;

  // Borders
  border: string;
  borderHover: string;
  borderAccent: string;

  // Glass
  glassBg: string;
  glassBorder: string;

  // Status
  success: string;
  warning: string;
  error: string;
  info: string;

  // Player
  playerBg: string;
  sidebarBg: string;

  // Shadows
  shadow: string;
  shadowAccent: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  isDark: boolean;
}

export const themes: Theme[] = [
  {
    id: 'purple',
    name: 'Purple',
    isDark: true,
    colors: {
      bg: '#0a0a14',
      bgSecondary: '#0f0f1e',
      bgTertiary: '#1a1a2e',
      surface: '#1e1e32',
      surfaceHover: '#252542',
      surfaceActive: '#2a2a4a',
      text: '#ffffff',
      textSecondary: '#a0a0b8',
      textMuted: '#606078',
      accent: '#8b5cf6',
      accentHover: '#7c3aed',
      accentLight: '#a78bfa',
      accentDark: '#6d28d9',
      border: 'rgba(255,255,255,0.08)',
      borderHover: 'rgba(255,255,255,0.15)',
      borderAccent: 'rgba(139,92,246,0.3)',
      glassBg: 'rgba(255,255,255,0.06)',
      glassBorder: 'rgba(255,255,255,0.1)',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
      playerBg: 'rgba(10,10,20,0.95)',
      sidebarBg: 'rgba(15,15,30,0.8)',
      shadow: 'rgba(0,0,0,0.3)',
      shadowAccent: 'rgba(139,92,246,0.3)',
    },
  },
  {
    id: 'neon-blue',
    name: 'Neon Blue',
    isDark: true,
    colors: {
      bg: '#050510',
      bgSecondary: '#0a0a1e',
      bgTertiary: '#101030',
      surface: '#151540',
      surfaceHover: '#1a1a50',
      surfaceActive: '#202060',
      text: '#ffffff',
      textSecondary: '#8888cc',
      textMuted: '#555588',
      accent: '#00d4ff',
      accentHover: '#00b8e6',
      accentLight: '#66e3ff',
      accentDark: '#0099cc',
      border: 'rgba(0,212,255,0.1)',
      borderHover: 'rgba(0,212,255,0.2)',
      borderAccent: 'rgba(0,212,255,0.4)',
      glassBg: 'rgba(0,212,255,0.05)',
      glassBorder: 'rgba(0,212,255,0.12)',
      success: '#00ff88',
      warning: '#ffcc00',
      error: '#ff3366',
      info: '#00d4ff',
      playerBg: 'rgba(5,5,16,0.95)',
      sidebarBg: 'rgba(10,10,30,0.8)',
      shadow: 'rgba(0,0,0,0.4)',
      shadowAccent: 'rgba(0,212,255,0.3)',
    },
  },
  {
    id: 'amoled-black',
    name: 'AMOLED Black',
    isDark: true,
    colors: {
      bg: '#000000',
      bgSecondary: '#0a0a0a',
      bgTertiary: '#111111',
      surface: '#1a1a1a',
      surfaceHover: '#222222',
      surfaceActive: '#2a2a2a',
      text: '#ffffff',
      textSecondary: '#999999',
      textMuted: '#555555',
      accent: '#ffffff',
      accentHover: '#e0e0e0',
      accentLight: '#ffffff',
      accentDark: '#cccccc',
      border: 'rgba(255,255,255,0.1)',
      borderHover: 'rgba(255,255,255,0.2)',
      borderAccent: 'rgba(255,255,255,0.3)',
      glassBg: 'rgba(255,255,255,0.04)',
      glassBorder: 'rgba(255,255,255,0.08)',
      success: '#00cc66',
      warning: '#ffaa00',
      error: '#ff0033',
      info: '#00aaff',
      playerBg: 'rgba(0,0,0,0.98)',
      sidebarBg: 'rgba(0,0,0,0.9)',
      shadow: 'rgba(0,0,0,0.5)',
      shadowAccent: 'rgba(255,255,255,0.15)',
    },
  },
  {
    id: 'spotify-green',
    name: 'Spotify Green',
    isDark: true,
    colors: {
      bg: '#0a0f0a',
      bgSecondary: '#0f1a0f',
      bgTertiary: '#142014',
      surface: '#1a2a1a',
      surfaceHover: '#203520',
      surfaceActive: '#284028',
      text: '#ffffff',
      textSecondary: '#a0c8a0',
      textMuted: '#5a8a5a',
      accent: '#1db954',
      accentHover: '#1aa34a',
      accentLight: '#1ed760',
      accentDark: '#168d40',
      border: 'rgba(29,185,84,0.12)',
      borderHover: 'rgba(29,185,84,0.25)',
      borderAccent: 'rgba(29,185,84,0.4)',
      glassBg: 'rgba(29,185,84,0.06)',
      glassBorder: 'rgba(29,185,84,0.12)',
      success: '#1db954',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
      playerBg: 'rgba(10,15,10,0.95)',
      sidebarBg: 'rgba(15,26,15,0.8)',
      shadow: 'rgba(0,0,0,0.3)',
      shadowAccent: 'rgba(29,185,84,0.3)',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    isDark: true,
    colors: {
      bg: '#120a08',
      bgSecondary: '#1a0f0a',
      bgTertiary: '#241510',
      surface: '#2e1c14',
      surfaceHover: '#3a2418',
      surfaceActive: '#462c1c',
      text: '#ffffff',
      textSecondary: '#d4a88c',
      textMuted: '#8a6050',
      accent: '#ff6b35',
      accentHover: '#e65a2a',
      accentLight: '#ff8c5a',
      accentDark: '#cc5528',
      border: 'rgba(255,107,53,0.12)',
      borderHover: 'rgba(255,107,53,0.25)',
      borderAccent: 'rgba(255,107,53,0.4)',
      glassBg: 'rgba(255,107,53,0.06)',
      glassBorder: 'rgba(255,107,53,0.12)',
      success: '#10b981',
      warning: '#fbbf24',
      error: '#ef4444',
      info: '#60a5fa',
      playerBg: 'rgba(18,10,8,0.95)',
      sidebarBg: 'rgba(26,15,10,0.8)',
      shadow: 'rgba(0,0,0,0.3)',
      shadowAccent: 'rgba(255,107,53,0.3)',
    },
  },
  {
    id: 'glass',
    name: 'Glass',
    isDark: true,
    colors: {
      bg: '#0d0d1a',
      bgSecondary: '#111122',
      bgTertiary: '#181830',
      surface: 'rgba(255,255,255,0.06)',
      surfaceHover: 'rgba(255,255,255,0.1)',
      surfaceActive: 'rgba(255,255,255,0.14)',
      text: '#ffffff',
      textSecondary: 'rgba(255,255,255,0.7)',
      textMuted: 'rgba(255,255,255,0.4)',
      accent: 'rgba(255,255,255,0.9)',
      accentHover: 'rgba(255,255,255,1)',
      accentLight: 'rgba(255,255,255,0.95)',
      accentDark: 'rgba(255,255,255,0.8)',
      border: 'rgba(255,255,255,0.1)',
      borderHover: 'rgba(255,255,255,0.2)',
      borderAccent: 'rgba(255,255,255,0.25)',
      glassBg: 'rgba(255,255,255,0.08)',
      glassBorder: 'rgba(255,255,255,0.15)',
      success: 'rgba(16,185,129,0.9)',
      warning: 'rgba(245,158,11,0.9)',
      error: 'rgba(239,68,68,0.9)',
      info: 'rgba(59,130,246,0.9)',
      playerBg: 'rgba(13,13,26,0.85)',
      sidebarBg: 'rgba(13,13,26,0.7)',
      shadow: 'rgba(0,0,0,0.2)',
      shadowAccent: 'rgba(255,255,255,0.1)',
    },
  },
];

// System theme definition (resolved at runtime)
export const systemTheme: Theme = {
  id: 'system',
  name: 'System',
  isDark: true,
  colors: themes[0].colors, // fallback, resolved dynamically
};
