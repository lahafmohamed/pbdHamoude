import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { demandeService } from '../services/api';
import { usePermission, Permissions } from '../hooks/usePermission';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ClipboardList, 
  CheckCircle, 
  Truck, 
  Package, 
  Clock, 
  ArrowRight,
  Loader2
} from 'lucide-react';

interface DemandeStats {
  total: number;
  brouillon: number;
  envoyee: number;
  approuvee: number;
  partiellementApprouvee: number;
  refusee: number;
  enCours: number;
  livree: number;
  cloturee: number;
  pendingDecision: number;
  pendingExecution: number;
  pendingClosure: number;
}

export function DashboardDemandeWidgets() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [stats, setStats] = useState<DemandeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentDemandes, setRecentDemandes] = useState<any[]>([]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Fetch all demandes and calculate stats
      const response = await demandeService.getAll({ limit: 100 });
      const demandes = response.data || response || [];

      const newStats: DemandeStats = {
        total: demandes.length,
        brouillon: demandes.filter((d: any) => d.statut === 'brouillon').length,
        envoyee: demandes.filter((d: any) => d.statut === 'envoyee').length,
        approuvee: demandes.filter((d: any) => d.statut === 'approuvee').length,
        partiellementApprouvee: demandes.filter((d: any) => d.statut === 'partiellement_approuvee').length,
        refusee: demandes.filter((d: any) => d.statut === 'refusee').length,
        enCours: demandes.filter((d: any) => d.statut === 'en_cours').length,
        livree: demandes.filter((d: any) => d.statut === 'livree').length,
        cloturee: demandes.filter((d: any) => d.statut === 'cloturee').length,
        pendingDecision: demandes.filter((d: any) => d.statut === 'envoyee').length,
        pendingExecution: demandes.filter((d: any) => ['approuvee', 'partiellement_approuvee'].includes(d.statut)).length,
        pendingClosure: demandes.filter((d: any) => d.statut === 'livree').length,
      };

      setStats(newStats);

      // Get recent demandes (last 5)
      const recent = demandes
        .sort((a: any, b: any) => new Date(b.date_creation).getTime() - new Date(a.date_creation).getTime())
        .slice(0, 5);
      setRecentDemandes(recent);
    } catch (error) {
      // Silent fail - dashboard widgets are non-critical
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (statut: string) => {
    const configs: Record<string, { label: string; variant: any }> = {
      brouillon: { label: 'Brouillon', variant: 'secondary' },
      envoyee: { label: 'Envoyée', variant: 'warning' },
      approuvee: { label: 'Approuvée', variant: 'success' },
      partiellement_approuvee: { label: 'Partielle', variant: 'info' },
      refusee: { label: 'Refusée', variant: 'destructive' },
      en_cours: { label: 'En cours', variant: 'warning' },
      livree: { label: 'Livrée', variant: 'success' },
      cloturee: { label: 'Clôturée', variant: 'default' },
    };
    const config = configs[statut] || { label: statut, variant: 'outline' };
    return <Badge variant={config.variant} className="text-xs">{config.label}</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const canCreate = hasPermission(Permissions.DEMANDE_CREATE);
  const canDecide = hasPermission(Permissions.DEMANDE_DECIDE);
  const canExecute = hasPermission(Permissions.DEMANDE_EXECUTE);
  const canClose = hasPermission(Permissions.DEMANDE_CLOSE);

  return (
    <div className="space-y-4">
      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {canDecide && stats.pendingDecision > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-warning">{stats.pendingDecision}</p>
                  <p className="text-sm text-muted-foreground">À décider</p>
                </div>
                <CheckCircle className="h-8 w-8 text-warning/50" />
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full mt-2 text-warning"
                onClick={() => navigate('/demandes')}
              >
                Voir les demandes <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {canExecute && stats.pendingExecution > 0 && (
          <Card className="border-info/50 bg-info/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-info">{stats.pendingExecution}</p>
                  <p className="text-sm text-muted-foreground">À exécuter</p>
                </div>
                <Truck className="h-8 w-8 text-info/50" />
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full mt-2 text-info"
                onClick={() => navigate('/demandes')}
              >
                Exécuter <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {canClose && stats.pendingClosure > 0 && (
          <Card className="border-success/50 bg-success/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-success">{stats.pendingClosure}</p>
                  <p className="text-sm text-muted-foreground">À clôturer</p>
                </div>
                <Package className="h-8 w-8 text-success/50" />
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full mt-2 text-success"
                onClick={() => navigate('/demandes')}
              >
                Clôturer <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {canCreate && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{stats.brouillon}</p>
                  <p className="text-sm text-muted-foreground">Brouillons</p>
                </div>
                <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <Button 
                size="sm" 
                className="w-full mt-2"
                onClick={() => navigate('/demandes/nouvelle')}
              >
                Nouvelle demande
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Résumé des demandes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <StatBox label="Total" value={stats.total} />
            <StatBox label="Envoyées" value={stats.envoyee} variant="warning" />
            <StatBox label="Approuvées" value={stats.approuvee} variant="success" />
            <StatBox label="Partielles" value={stats.partiellementApprouvee} variant="info" />
            <StatBox label="Refusées" value={stats.refusee} variant="destructive" />
            <StatBox label="En cours" value={stats.enCours} variant="warning" />
            <StatBox label="Livrées" value={stats.livree} variant="success" />
            <StatBox label="Clôturées" value={stats.cloturee} />
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      {recentDemandes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Activité récente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentDemandes.map((demande) => (
                <div 
                  key={demande.id} 
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer"
                  onClick={() => navigate(`/demandes/${demande.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-sm">{demande.numero}</div>
                    <div className="text-sm text-muted-foreground">
                      {demande.magasin_nom} → {demande.depot_nom}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(demande.statut)}
                    <span className="text-xs text-muted-foreground">
                      {new Date(demande.date_creation).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full mt-3"
              onClick={() => navigate('/demandes')}
            >
              Voir toutes les demandes <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatBox({ label, value, variant }: { label: string; value: number; variant?: 'default' | 'warning' | 'success' | 'info' | 'destructive' }) {
  const colorClasses = {
    default: 'bg-muted',
    warning: 'bg-warning/10 text-warning',
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    destructive: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className={`text-center p-2 rounded-lg ${colorClasses[variant || 'default']}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default DashboardDemandeWidgets;
