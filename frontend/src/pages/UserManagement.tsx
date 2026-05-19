import { useState, useEffect } from 'react';
import { Loader2, Plus, Shield, ShieldAlert, KeyRound, MapPin, Search } from 'lucide-react';
import { adminUserService, stockLocationService } from '../services/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface User {
  id: number;
  username: string;
  email: string | null;
  nom_complet: string | null;
  role: string;
  role_id: number;
  actif: boolean;
  locations: { id: number; nom: string; type: string }[] | null;
  created_at: string;
}

interface Role {
  id: number;
  nom: string;
  description: string;
  is_system: boolean;
}

interface Location {
  id: number;
  nom: string;
  location_type: string;
}

const SELECT_CLS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    nom_complet: '',
    password: '',
    role_id: '',
    actif: true,
    location_ids: [] as number[],
  });

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, rolesRes, locationsRes] = await Promise.all([
        adminUserService.getAll(1, 100),
        adminUserService.getRoles(),
        stockLocationService.getAll()
      ]);
      setUsers(usersRes.data || usersRes);
      setRoles(rolesRes);
      setLocations(locationsRes.data || locationsRes);
    } catch {
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      email: '',
      nom_complet: '',
      password: '',
      role_id: '',
      actif: true,
      location_ids: [],
    });
    setShowForm(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email || '',
      nom_complet: user.nom_complet || '',
      password: '', // Empty unless changing
      role_id: user.role_id?.toString() || '',
      actif: user.actif,
      location_ids: user.locations ? user.locations.map(l => l.id) : [],
    });
    setShowForm(true);
  };

  const toggleLocation = (id: number) => {
    setFormData(prev => ({
      ...prev,
      location_ids: prev.location_ids.includes(id) 
        ? prev.location_ids.filter(locId => locId !== id)
        : [...prev.location_ids, id]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        ...formData,
        role_id: parseInt(formData.role_id),
      };

      if (editingUser) {
        // Remove password if empty on edit
        if (!payload.password) {
          delete (payload as any).password;
        }
        await adminUserService.update(editingUser.id, payload);
        toast.success('Utilisateur mis à jour');
      } else {
        await adminUserService.create(payload);
        toast.success('Utilisateur créé');
      }

      setShowForm(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Erreur lors de l'opération");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.nom_complet && u.nom_complet.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Gestion des Utilisateurs
          </h1>
          <p className="text-muted-foreground text-sm">Créez et gérez les accès et rôles des utilisateurs</p>
        </div>
        
        <div className="flex w-full md:w-auto gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              className="pl-8"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button onClick={handleOpenCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouvel Utilisateur
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-3 font-medium">Utilisateur</th>
                <th className="px-4 py-3 font-medium">Rôle</th>
                <th className="px-4 py-3 font-medium">Boutiques assignées</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Aucun utilisateur trouvé
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{user.nom_complet || '—'}</div>
                      <div className="text-xs text-muted-foreground">@{user.username}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.locations && user.locations.length > 0 ? (
                          user.locations.map(loc => (
                            <span key={loc.id} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                              <MapPin className="h-3 w-3" />
                              {loc.nom}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Aucune assignation</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        user.actif ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {user.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(user)}>
                        Modifier
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingUser ? <ShieldAlert className="h-5 w-5 text-primary" /> : <Shield className="h-5 w-5 text-primary" />}
              {editingUser ? "Modifier l'utilisateur" : 'Créer un nouvel utilisateur'}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-6 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nom_complet">Nom complet</Label>
                <Input 
                  id="nom_complet" 
                  value={formData.nom_complet} 
                  onChange={e => setFormData({...formData, nom_complet: e.target.value})} 
                  placeholder="Jean Dupont"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="username">Identifiant (Username) <span className="text-red-500">*</span></Label>
                <Input 
                  id="username" 
                  value={formData.username} 
                  onChange={e => setFormData({...formData, username: e.target.value})} 
                  required
                  disabled={!!editingUser}
                  className={editingUser ? 'bg-muted' : ''}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email"
                  value={formData.email} 
                  onChange={e => setFormData({...formData, email: e.target.value})} 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="flex justify-between">
                  <span>Mot de passe {editingUser ? '(optionnel)' : <span className="text-red-500">*</span>}</span>
                </Label>
                <div className="relative">
                  <KeyRound className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    id="password" 
                    type="password"
                    value={formData.password} 
                    onChange={e => setFormData({...formData, password: e.target.value})} 
                    required={!editingUser}
                    className="pl-8"
                    placeholder={editingUser ? 'Laisser vide pour ne pas changer' : 'Mot de passe sécurisé'}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Rôle assigné <span className="text-red-500">*</span></Label>
                <select 
                  id="role" 
                  className={SELECT_CLS}
                  value={formData.role_id}
                  onChange={e => setFormData({...formData, role_id: e.target.value})}
                  required
                >
                  <option value="">Sélectionner un rôle</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.nom} - {r.description}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 flex flex-col justify-center">
                <Label className="mb-2">Statut du compte</Label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.actif}
                    onChange={e => setFormData({...formData, actif: e.target.checked})}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">{formData.actif ? 'Compte Actif' : 'Compte Inactif'}</span>
                </label>
              </div>
            </div>

            <div className="border-t pt-4">
              <Label className="text-base mb-3 block">Accès aux Boutiques / Dépôts</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-1">
                {locations.map(loc => (
                  <label 
                    key={loc.id} 
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      formData.location_ids.includes(loc.id) ? 'bg-primary/5 border-primary/50' : 'bg-background hover:bg-muted/50'
                    }`}
                  >
                    <input 
                      type="checkbox"
                      checked={formData.location_ids.includes(loc.id)}
                      onChange={() => toggleLocation(loc.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{loc.nom}</span>
                      <span className="text-xs text-muted-foreground uppercase">{loc.location_type}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement...</> : 'Enregistrer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
