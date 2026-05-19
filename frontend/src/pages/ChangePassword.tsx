import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { authService } from '../services/authService';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ChangePassword() {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error('Le nouveau mot de passe doit avoir au moins 6 caractères.');
      return;
    }
    if (newPassword !== confirm) {
      toast.error('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      toast.success('Mot de passe mis à jour. Veuillez vous reconnecter.');
      logout();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur lors du changement de mot de passe.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-md border bg-card shadow-sm">
        <div className="p-6">
          <h1 className="text-xl font-semibold mb-1">Changement de mot de passe requis</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Mot de passe actuel</Label>
              <Input
                id="current"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new">Nouveau mot de passe</Label>
              <Input
                id="new"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirmer le nouveau mot de passe</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Mise à jour…
                </>
              ) : (
                'Changer le mot de passe'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
