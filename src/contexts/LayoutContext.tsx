import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

interface LayoutContextType {
  sidebarOpen: boolean;
  sidebarWidth: number;
  breakpoint: Breakpoint;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const useLayout = () => {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
};

const BREAKPOINTS = {
  mobile: 640,
  tablet: 1024,
} as const;

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= BREAKPOINTS.tablet;
  });
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');

  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    if (width < BREAKPOINTS.mobile) setBreakpoint('mobile');
    else if (width < BREAKPOINTS.tablet) setBreakpoint('tablet');
    else setBreakpoint('desktop');
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  const handleSetSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(Math.max(200, Math.min(400, width)));
  }, []);

  const value = useMemo(() => ({
    sidebarOpen,
    sidebarWidth,
    breakpoint,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    setSidebarWidth: handleSetSidebarWidth,
  }), [sidebarOpen, sidebarWidth, breakpoint, openSidebar, closeSidebar, toggleSidebar, handleSetSidebarWidth]);

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
};