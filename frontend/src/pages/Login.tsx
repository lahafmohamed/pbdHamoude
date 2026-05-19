import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const loginSchema = z.object({
  username: z.string().min(1, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  const from = (location.state as any)?.from?.pathname || '/';

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError('');

    try {
      await login(data.username, data.password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Échec de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-md border bg-card shadow-sm">
        <div className="p-6">
          <h1 className="text-xl font-semibold text-center mb-1">Magasin Programme</h1>
          <p className="text-center text-sm text-muted-foreground mb-6">
            Connectez-vous pour continuer
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="username">Identifiant</Label>
              <Input
                id="username"
                type="text"
                aria-invalid={!!errors.username}
                className={errors.username ? 'border-danger-500 focus-visible:ring-danger-500/40' : ''}
                {...register('username')}
                autoComplete="username"
              />
              {errors.username && (
                <p className="text-xs text-danger-600">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                aria-invalid={!!errors.password}
                className={errors.password ? 'border-danger-500 focus-visible:ring-danger-500/40' : ''}
                {...register('password')}
                autoComplete="current-password"
              />
              {errors.password && (
                <p className="text-xs text-danger-600">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connexion…
                </>
              ) : (
                'Se connecter'
              )}
            </Button>
          </form>

          {(import.meta as any).env?.DEV && (
            <>
              <div className="my-6 flex items-center text-xs text-muted-foreground">
                <div className="flex-1 border-t" />
                <span className="px-2">Comptes de démonstration</span>
                <div className="flex-1 border-t" />
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p><strong>admin</strong> / admin123</p>
                <p><strong>manager</strong> / manager123</p>
                <p><strong>caissier</strong> / caissier123</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
