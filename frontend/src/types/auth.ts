export interface User {
  id: number;
  username: string;
  email: string | null;
  nom_complet: string | null;
  role: 'admin' | 'manager' | 'caissier' | 'depot_staff' | 'magasin_staff' | 'viewer';
  actif: boolean;
  must_change_password: boolean;
  dernier_login: string | null;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: User;
    token: string;
  };
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: { field: string; message: string }[];
}
