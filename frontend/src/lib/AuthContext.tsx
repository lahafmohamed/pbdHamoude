import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '../types/auth';
import { authService } from '../services/authService';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: ('admin' | 'manager' | 'caissier' | 'depot_staff' | 'magasin_staff' | 'viewer')[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');

    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
      // Verify token is still valid
      authService.getCurrentUser()
        .then((userData) => {
          setUser(userData);
          localStorage.setItem('auth_user', JSON.stringify(userData));
        })
        .catch(() => {
          authService.logout();
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const response = await authService.login({ username, password });
    if (response.success && response.data) {
      setUser(response.data.user);
    } else {
      throw new Error((response as any).error || 'Échec de connexion');
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    window.location.href = '/login';
  };

  const hasRole = (...roles: ('admin' | 'manager' | 'caissier' | 'depot_staff' | 'magasin_staff' | 'viewer')[]) => {
    return user !== null && roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      hasRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
