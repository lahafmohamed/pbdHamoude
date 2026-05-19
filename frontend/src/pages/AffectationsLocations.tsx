import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { userLocationAssignmentService } from '../services/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface AssignmentUser {
  id: number;
  username: string;
  nom_complet: string | null;
  role: 'admin' | 'manager' | 'caissier';
  actif: boolean;
  locations: { location_id: number; est_defaut: boolean }[];
}

interface AssignmentLocation {
  id: number;
  code: string;
  nom: string;
  est_principal: boolean;
}

export default function AffectationsLocations() {
  const [users, setUsers] = useState<AssignmentUser[]>([]);
  const [locations, setLocations] = useState<AssignmentLocation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [defaultLocationId, setDefaultLocationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  useEffect(() => {
    void fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const [usersData, locationsData] = await Promise.all([
        userLocationAssignmentService.getUsers(),
        userLocationAssignmentService.getLocations(),
      ]);

      const usersList: AssignmentUser[] = usersData.data || usersData;
      const locationsList: AssignmentLocation[] = locationsData.data || locationsData;

      setUsers(usersList);
      setLocations(locationsList);

      if (usersList.length > 0) {
        await selectUser(usersList[0].id, usersList);
      }
    } catch {
      toast.error('Erreur chargement des affectations');
    } finally {
      setLoading(false);
    }
  };

  const selectUser = async (userId: number, usersSource?: AssignmentUser[]) => {
    setSelectedUserId(userId);

    try {
      const detail = await userLocationAssignmentService.getByUserId(userId);
      const user = (detail.data || detail) as AssignmentUser;

      const locationIds = user.locations.map((entry) => entry.location_id);
      const defaultId = user.locations.find((entry) => entry.est_defaut)?.location_id || null;

      setSelectedLocationIds(locationIds);
      setDefaultLocationId(defaultId);

      if (usersSource) {
        setUsers(usersSource);
      }
    } catch {
      toast.error('Erreur chargement des affectations utilisateur');
    }
  };

  const toggleLocation = (locationId: number, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selectedLocationIds, locationId]))
      : selectedLocationIds.filter((id) => id !== locationId);

    setSelectedLocationIds(next);

    if (!checked && defaultLocationId === locationId) {
      setDefaultLocationId(next[0] || null);
    }
  };

  const handleSave = async () => {
    if (!selectedUserId) return;

    if (selectedLocationIds.length === 0) {
      toast.error('Selectionne au moins une location');
      return;
    }

    setSaving(true);
    try {
      await userLocationAssignmentService.update(selectedUserId, {
        location_ids: selectedLocationIds,
        default_location_id: defaultLocationId,
      });

      toast.success('Affectations mises a jour');

      const usersData = await userLocationAssignmentService.getUsers();
      const usersList: AssignmentUser[] = usersData.data || usersData;
      setUsers(usersList);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur mise a jour affectations');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Affectations Utilisateur-Locations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure les locations accessibles pour chaque utilisateur et la location par défaut.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Utilisateurs</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Utilisateur</th>
                    <th className="px-3 py-2 font-medium">Rôle</th>
                    <th className="px-3 py-2 font-medium">Statut</th>
                    <th className="px-3 py-2 font-medium">Locations</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className={`cursor-pointer hover:bg-muted/30 ${selectedUserId === user.id ? 'bg-primary/10' : ''}`}
                      onClick={() => void selectUser(user.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{user.username}</div>
                        {user.nom_complet && (
                          <div className="text-xs text-muted-foreground">{user.nom_complet}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.actif ? 'bg-success-100 text-success-700' : 'bg-muted text-muted-foreground'
                        }`}>
                          {user.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-3 py-2 num">{user.locations.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Affectations</h2>
            {!selectedUser ? (
              <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">
                Sélectionnez un utilisateur pour modifier ses affectations.
              </div>
            ) : (
              <>
                <div className="mb-4 text-sm">
                  <span className="font-semibold">Utilisateur:</span> {selectedUser.username}
                </div>

                <div className="space-y-2 mb-6">
                  {locations.map((location) => {
                    const checked = selectedLocationIds.includes(location.id);
                    return (
                      <label key={location.id} className="flex items-center justify-between gap-3 p-3 rounded-md border hover:bg-muted/30 cursor-pointer">
                        <div>
                          <div className="font-medium">
                            {location.nom} <span className="text-xs text-muted-foreground">({location.code})</span>
                          </div>
                          {location.est_principal && (
                            <div className="text-xs text-primary">Location principale système</div>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                          checked={checked}
                          onChange={(e) => toggleLocation(location.id, e.target.checked)}
                        />
                      </label>
                    );
                  })}
                </div>

                <div className="space-y-1.5 mb-6">
                  <Label htmlFor="default-location">Location par défaut</Label>
                  <select
                    id="default-location"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={defaultLocationId ?? ''}
                    onChange={(e) => setDefaultLocationId(e.target.value ? parseInt(e.target.value, 10) : null)}
                    disabled={selectedLocationIds.length === 0}
                  >
                    <option value="">Aucune</option>
                    {locations
                      .filter((location) => selectedLocationIds.includes(location.id))
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.nom} ({location.code})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enregistrement…
                      </>
                    ) : (
                      'Enregistrer'
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
