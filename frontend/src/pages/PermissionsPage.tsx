import { useState, useEffect } from 'react';
import { Loader2, ShieldCheck, Check, RotateCcw, Shield, CheckSquare, Square } from 'lucide-react';
import { adminUserService } from '../services/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface User {
  id: number;
  username: string;
  email: string | null;
  nom_complet: string | null;
  role: string;
}

interface Permission {
  id: number;
  code: string;
  nom: string;
  description: string;
  module: string;
  is_default: boolean;
  is_enabled: boolean;
}

export default function PermissionsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [customiserPermissions, setCustomiserPermissions] = useState(false);
  
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch users on load
  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await adminUserService.getAll(1, 100);
        const usersList = res.data || res;
        setUsers(usersList);
        if (usersList.length > 0) {
          setSelectedUserId(usersList[0].id);
        }
      } catch (err) {
        toast.error('Erreur lors du chargement des utilisateurs');
      } finally {
        setLoadingUsers(false);
      }
    }
    fetchUsers();
  }, []);

  // Fetch permissions when user changes
  useEffect(() => {
    if (!selectedUserId) return;
    
    async function fetchUserPermissions() {
      setLoadingPermissions(true);
      try {
        const res = await adminUserService.getUserPermissions(Number(selectedUserId));
        setSelectedUser(res.user);
        setPermissions(res.permissions);
        setCustomiserPermissions(res.user.customiser_permissions);
      } catch (err) {
        toast.error('Erreur lors du chargement des permissions');
      } finally {
        setLoadingPermissions(false);
      }
    }
    fetchUserPermissions();
  }, [selectedUserId]);

  const handleTogglePermission = (permId: number) => {
    if (!customiserPermissions) return;
    setPermissions(prev =>
      prev.map(p => (p.id === permId ? { ...p, is_enabled: !p.is_enabled } : p))
    );
  };

  const handleCheckAll = () => {
    if (!customiserPermissions) return;
    setPermissions(prev => prev.map(p => ({ ...p, is_enabled: true })));
  };

  const handleUncheckAll = () => {
    if (!customiserPermissions) return;
    setPermissions(prev => prev.map(p => ({ ...p, is_enabled: false })));
  };

  const handleResetToRole = () => {
    if (!customiserPermissions) return;
    setPermissions(prev => prev.map(p => ({ ...p, is_enabled: p.is_default })));
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const enabledIds = permissions
        .filter(p => p.is_enabled)
        .map(p => p.id);
      
      await adminUserService.updateUserPermissions(Number(selectedUserId), {
        customiser_permissions: customiserPermissions,
        permission_ids: enabledIds,
      });
      toast.success('Permissions enregistrées avec succès');
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde des permissions');
    } finally {
      setSaving(false);
    }
  };

  // Group permissions by module
  const groupedPermissions: { [key: string]: Permission[] } = {};
  permissions.forEach(p => {
    if (!groupedPermissions[p.module]) {
      groupedPermissions[p.module] = [];
    }
    groupedPermissions[p.module].push(p);
  });

  const totalPermissions = permissions.length;
  const checkedPermissionsCount = permissions.filter(p => p.is_enabled).length;

  if (loadingUsers) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      {/* Page Header */}
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Permission
        </h1>
        {selectedUser && (
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Sauvegarder les permissions
          </Button>
        )}
      </div>

      {/* User Selector Dropdown */}
      <div className="bg-card border rounded-lg p-4 mb-6 shadow-sm">
        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Utilisateur
        </label>
        <select
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : '')}
          className="h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.nom_complet || u.username} ({u.username})
            </option>
          ))}
        </select>
      </div>

      {loadingPermissions ? (
        <div className="flex justify-center p-12 bg-card border rounded-lg">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : selectedUser ? (
        <div className="space-y-6">
          {/* User Details Banner */}
          <div className="bg-card border rounded-lg p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-lg text-foreground">
                  {selectedUser.nom_complet || selectedUser.username}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({selectedUser.email || 'Aucun email'}) — rôle: <span className="font-semibold uppercase">{selectedUser.role}</span>
                </span>
              </div>
            </div>
            <div>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide border shadow-sm ${
                customiserPermissions 
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50' 
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/50'
              }`}>
                Source: {customiserPermissions ? 'Personnalisé' : 'Défaut du rôle'}
              </span>
            </div>
          </div>

          {/* Sources Radio & Action Buttons */}
          <div className="bg-card border rounded-lg p-5 shadow-sm space-y-4">
            {/* Toggle Radio Buttons */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 font-medium text-sm cursor-pointer select-none">
                <input
                  type="radio"
                  name="permissionSource"
                  checked={!customiserPermissions}
                  onChange={() => setCustomiserPermissions(false)}
                  className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                />
                Utiliser défaut du rôle ({selectedUser.role.toUpperCase()})
              </label>

              <label className="flex items-center gap-2 font-medium text-sm cursor-pointer select-none">
                <input
                  type="radio"
                  name="permissionSource"
                  checked={customiserPermissions}
                  onChange={() => setCustomiserPermissions(true)}
                  className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                />
                Personnaliser (override)
              </label>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-3 border-t gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCheckAll}
                  disabled={!customiserPermissions}
                  className="text-xs h-8"
                >
                  Tout cocher
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUncheckAll}
                  disabled={!customiserPermissions}
                  className="text-xs h-8"
                >
                  Tout décocher
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToRole}
                  disabled={!customiserPermissions}
                  className="text-xs h-8 gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  Réinitialiser au rôle
                </Button>
              </div>

              <div className="bg-muted px-3 py-1 rounded text-xs font-semibold text-muted-foreground border">
                {checkedPermissionsCount} / {totalPermissions} cochées
              </div>
            </div>
          </div>

          {/* Grouped Modules of Permissions */}
          <div className="space-y-6">
            {Object.entries(groupedPermissions).map(([moduleName, perms]) => {
              const checkedCountInModule = perms.filter(p => p.is_enabled).length;
              return (
                <div key={moduleName} className="bg-card border rounded-lg shadow-sm overflow-hidden">
                  {/* Module Title Banner */}
                  <div className="bg-muted/40 border-b px-4 py-3 flex items-center justify-between">
                    <span className="font-semibold text-sm text-foreground flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      {moduleName}
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground bg-background px-2 py-0.5 rounded border">
                      {checkedCountInModule} / {perms.length}
                    </span>
                  </div>

                  {/* Permissions Grid */}
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {perms.map(p => {
                      const isDisabled = !customiserPermissions;
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isDisabled && handleTogglePermission(p.id)}
                          className={`flex items-start gap-3 p-4 rounded-lg border transition-all ${
                            isDisabled ? 'opacity-85' : 'cursor-pointer hover:bg-muted/30'
                          } ${
                            p.is_enabled 
                              ? 'bg-emerald-50/20 border-emerald-200 dark:bg-emerald-950/5 dark:border-emerald-900/50' 
                              : 'bg-background hover:border-gray-300'
                          }`}
                        >
                          {/* Checkbox Icon */}
                          <div className={`mt-0.5 flex-shrink-0 transition-colors ${
                            isDisabled ? 'text-muted-foreground' : p.is_enabled ? 'text-emerald-600' : 'text-gray-300'
                          }`}>
                            {p.is_enabled ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold truncate ${
                                p.is_enabled ? 'text-foreground' : 'text-muted-foreground'
                              }`}>
                                {p.nom}
                              </span>
                              {p.is_default && (
                                <span className="inline-flex items-center rounded bg-gray-100 px-1 py-0.2 text-[9px] font-bold text-gray-500 border">
                                  défaut
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              {p.code}
                            </div>
                            {p.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                                {p.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center p-8 bg-card border rounded-lg text-muted-foreground shadow-sm">
          Aucun utilisateur sélectionné
        </div>
      )}
    </div>
  );
}
