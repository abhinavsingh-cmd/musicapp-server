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

const demoUsers: User[] = [
  {
    id: 'user-1',
    name: 'Alex Johnson',
    email: 'alex@example.com',
    avatar: 'https://picsum.photos/seed/user1/200/200.jpg',
    plan: 'premium',
  },
  {
    id: 'user-2',
    name: 'Maria Garcia',
    email: 'maria@example.com',
    avatar: 'https://picsum.photos/seed/user2/200/200.jpg',
    plan: 'free',
  },
  {
    id: 'user-3',
    name: 'David Chen',
    email: 'david@example.com',
    avatar: 'https://picsum.photos/seed/user3/200/200.jpg',
    plan: 'pro',
  },
];

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
    await new Promise(resolve => setTimeout(resolve, 500));
    const foundUser = demoUsers.find(u => u.email === email);
    if (foundUser) {
      setUser(foundUser);
      localStorage.setItem('musicAppUser', JSON.stringify(foundUser));
    } else {
      const newUser: User = {
        id: `user-${Date.now()}`,
        name: email.split('@')[0],
        email,
        avatar: `https://picsum.photos/seed/${encodeURIComponent(email)}/200/200.jpg`,
        plan: 'free',
      };
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
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout, upgradePlan }}>
      {children}
    </AuthContext.Provider>
  );
};