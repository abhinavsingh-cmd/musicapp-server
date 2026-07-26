import { createContext, useContext, useState, type ReactNode } from 'react';
import { User } from '../types/music';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  upgradePlan: (plan: 'premium' | 'pro') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

function generateAvatar(name: string): string {
  const initials = name.split(/[@.\s]/).filter(Boolean).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('');
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},60%,40%)"/><text x="100" y="115" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">${initials}</text></svg>`)}`;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('musicAppUser');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      localStorage.removeItem('musicAppUser');
      return null;
    }
  });

  const isAuthenticated = !!user;

  const login = async (email: string, _password: string) => {
    let savedUsers: User[];
    try {
      const parsed = JSON.parse(localStorage.getItem('musicAppUsers') || '[]');
      savedUsers = Array.isArray(parsed) ? parsed : [];
    } catch {
      savedUsers = [];
    }
    const foundUser = savedUsers.find(u => u.email === email);
    if (foundUser) {
      setUser(foundUser);
      localStorage.setItem('musicAppUser', JSON.stringify(foundUser));
    } else {
      const newUser: User = {
        id: `user-${Date.now()}`,
        name: email.split('@')[0],
        email,
        avatar: generateAvatar(email),
        plan: 'free',
      };
      savedUsers.push(newUser);
      localStorage.setItem('musicAppUsers', JSON.stringify(savedUsers));
      setUser(newUser);
      localStorage.setItem('musicAppUser', JSON.stringify(newUser));
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('musicAppUser');
  };

  const upgradePlan = (plan: 'premium' | 'pro') => {
    if (user) {
      const updatedUser = { ...user, plan };
      setUser(updatedUser);
      localStorage.setItem('musicAppUser', JSON.stringify(updatedUser));
      try {
        const savedUsers = JSON.parse(localStorage.getItem('musicAppUsers') || '[]') as User[];
        const idx = savedUsers.findIndex(u => u.id === user.id);
        if (idx >= 0) {
          savedUsers[idx] = { ...savedUsers[idx], plan };
          localStorage.setItem('musicAppUsers', JSON.stringify(savedUsers));
        }
      } catch {}
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout, upgradePlan }}>
      {children}
    </AuthContext.Provider>
  );
};
