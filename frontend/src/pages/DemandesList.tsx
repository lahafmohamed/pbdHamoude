import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { demandeService, stockLocationService } from '../services/api';
import { fuzzyScore } from '../utils/format';
import { useAuth } from '../lib/AuthContext';
import { usePermission, Permissions } from '../hooks/usePermission';
import { RequirePermission } from '../components/RequirePermission';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Plus, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Package, 
  Truck, 
  Check,
  Loader2,
  RefreshCw,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';

interface Demande {
  id: number;
  numero: string;
  statut: string;
  magasin_nom: string;
  depot_nom: string;
  magasin_code: string;
  depot_code: string;
  created_by_nom: string;
  date_creation: string;
  date_envoi: string | null;
  date_decision: string | null;
  date_execution: string | null;
  date_livraison: string | null;
  numero_transfer: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning' | 'success' | 'info'; icon: any }> = {
  brouillon: { label: 'Brouillon', variant: 'secondary', icon: Clock },
  envoyee: { label: 'Envoyée', variant: 'warning', icon: Truck },
  approuvee: { label: 'Approuvée', variant: 'success', icon: CheckCircle },
  partiellement_approuvee: { label: 'Partiellement', variant: 'info', icon: CheckCircle },
  refusee: { label: 'Refusée', variant: 'destructive', icon: XCircle },
  en_cours: { label: 'En cours', variant: 'warning', icon: Package },
  livree: { label: 'Livrée', variant: 'success', icon: Check },
  cloturee: { label: 'Clôturée', variant: 'default', icon: CheckCircle },
};

export default function DemandesList() {
  const navigate = useNavigate();
  useAuth();
  const { userRole } = usePermission();
  
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatut, setFilterStatut] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [_locations, setLocations] = useState<any[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    enAttente: 0,
    aTraiter: 0,
    livrees: 0,
  });

  const isMagasin = userRole === 'magasin_staff' || userRole === 'caissier';
  const isDepot = userRole === 'depot_staff';
  const isAdmin = userRole === 'admin';

  useEffect(() => {
    loadLocations();
    loadDemandes();
  }, [filterStatut]);

  const loadLocations = async () => {
    try {
      const response = await stockLocationService.getAll();
      setLocations(response.data || response || []);
    } catch {
      // Silent fail
    }
  };

  const loadDemandes = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (filterStatut !== 'all') filters.statut = filterStatut;
      
      // For depot staff, default to actionable states
      if (isDepot && filterStatut === 'all') {
        // Backend handles default filtering
      }

      const response = await demandeService.getAll(filters);
      const data = response.data || response || [];
      setDemandes(data);

      // Calculate stats
      setStats({
        total: data.length,
        enAttente: data.filter((d: Demande) => d.statut === 'envoyee').length,
        aTraiter: data.filter((d: Demande) => ['envoyee', 'approuvee', 'partiellement_approuvee'].includes(d.statut)).length,
        livrees: data.filter((d: Demande) => d.statut === 'livree').length,
      });
    } catch (error: any) {
      toast.error('Erreur lors du chargement des demandes');
    } finally {
      setLoading(false);
    }
  };

  const filteredDemandes = !searchQuery.trim()
    ? demandes
    : demandes
        .map((d) => ({
          d,
          score: Math.max(
            fuzzyScore(searchQuery, d.numero),
            fuzzyScore(searchQuery, d.magasin_nom),
            fuzzyScore(searchQuery, d.depot_nom),
            fuzzyScore(searchQuery, d.created_by_nom || ''),
          ),
        }))
        .filter((row) => row.score > 0)
        .sort((x, y) => y.score - x.score)
        .map((row) => row.d);

  const StatusBadge = ({ statut }: { statut: string }) => {
    const config = STATUS_CONFIG[statut] || { label: statut, variant: 'outline', icon: Clock };
    const Icon = config.icon;
    return (
      <Badge variant={config.variant as any} className="gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getActionLabel = (statut: string) => {
    switch (statut) {
      case 'brouillon':
        return 'Modifier / Envoyer';
      case 'envoyee':
        return isDepot ? 'Décider' : 'En attente décision';
      case 'approuvee':
      case 'partiellement_approuvee':
        return isDepot ? 'Exécuter' : 'En attente livraison';
      case 'en_cours':
        return 'En préparation';
      case 'livree':
        return isMagasin ? 'Clôturer' : 'Attente clôture';
      default:
        return 'Voir détail';
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 sm:h-8 sm:w-8" />
            Demandes de Réapprovisionnement
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isMagasin && 'Créez et suivez vos demandes vers le dépôt'}
            {isDepot && 'Traitez les demandes des magasins'}
            {isAdmin && 'Gestion complète des demandes'}
          </p>
        </div>

        <RequirePermission permission={Permissions.DEMANDE_CREATE} hideIfUnauthorized>
          <Button onClick={() => navigate('/demandes/nouvelle')} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Nouvelle Demande
          </Button>
        </RequirePermission>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total demandes</div>
          </CardContent>
        </Card>
        {(isDepot || isAdmin) && (
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-warning">{stats.aTraiter}</div>
              <div className="text-xs text-muted-foreground">À traiter</div>
            </CardContent>
          </Card>
        )}
        {(isMagasin || isAdmin) && (
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-warning">{stats.enAttente}</div>
              <div className="text-xs text-muted-foreground">En attente</div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-success">{stats.livrees}</div>
            <div className="text-xs text-muted-foreground">Livrées</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par numéro, magasin, dépôt..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filterStatut}
                onChange={(e) => setFilterStatut(e.target.value)}
              >
                <option value="all">Tous les statuts</option>
                {isMagasin && <option value="brouillon">Brouillon</option>}
                <option value="envoyee">Envoyée</option>
                <option value="approuvee">Approuvée</option>
                <option value="partiellement_approuvee">Partiellement approuvée</option>
                <option value="refusee">Refusée</option>
                <option value="en_cours">En cours</option>
                <option value="livree">Livrée</option>
                <option value="cloturee">Clôturée</option>
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={loadDemandes} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Demandes Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDemandes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Package className="h-12 w-12 mb-4 opacity-50" />
              <p>Aucune demande trouvée</p>
              <RequirePermission permission={Permissions.DEMANDE_CREATE} hideIfUnauthorized>
                <Button 
                  variant="link" 
                  onClick={() => navigate('/demandes/nouvelle')}
                  className="mt-2"
                >
                  Créer une demande
                </Button>
              </RequirePermission>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-sm font-medium">N° Demande</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Magasin</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Dépôt</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Statut</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Créée par</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDemandes.map((demande) => (
                    <tr key={demande.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <span className="font-mono font-medium">{demande.numero}</span>
                        {demande.numero_transfer && (
                          <div className="text-xs text-muted-foreground">
                            Transfert: {demande.numero_transfer}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {demande.magasin_nom}
                        <span className="text-xs text-muted-foreground ml-1">({demande.magasin_code})</span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {demande.depot_nom}
                        <span className="text-xs text-muted-foreground ml-1">({demande.depot_code})</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge statut={demande.statut} />
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(demande.date_creation).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {demande.created_by_nom || '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/demandes/${demande.id}`)}
                          className="gap-1"
                        >
                          <Eye className="h-4 w-4" />
                          {getActionLabel(demande.statut)}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
