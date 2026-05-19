import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { demandeService } from '../services/api';
import { useAuth } from '../lib/AuthContext';
import { usePermission, Permissions } from '../hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Send, 
  CheckCircle, 
  XCircle, 
  Package, 
  Check,
  Loader2,
  Clock,
  AlertCircle,
  History,
  User,
  MapPin,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { DemandeDecisionDialog } from '../components/DemandeDecisionDialog';
import { DemandeClotureDialog } from '../components/DemandeClotureDialog';

interface Ligne {
  id: number;
  produit_id: number;
  produit_nom: string;
  reference: string;
  quantite_demandee: number;
  quantite_approuvee: number | null;
  quantite_livree: number | null;
  notes: string | null;
}

interface HistoriqueEntry {
  id: number;
  from_statut: string | null;
  to_statut: string;
  timestamp: string;
  username: string | null;
  nom_complet: string | null;
  payload: any;
}

interface DemandeDetail {
  id: number;
  numero: string;
  statut: string;
  magasin_id: number;
  magasin_nom: string;
  magasin_code: string;
  depot_id: number;
  depot_nom: string;
  depot_code: string;
  created_by_user_id: number;
  created_by_nom: string;
  decided_by_nom: string | null;
  executed_by_nom: string | null;
  closed_by_nom: string | null;
  date_creation: string;
  date_envoi: string | null;
  date_decision: string | null;
  date_execution: string | null;
  date_livraison: string | null;
  date_cloture: string | null;
  motif: string | null;
  raison_refus: string | null;
  numero_transfer: string | null;
  transfert_id: number | null;
  lignes: Ligne[];
  historique: HistoriqueEntry[];
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning' | 'success' | 'info'; icon: any; description: string }> = {
  brouillon: { 
    label: 'Brouillon', 
    variant: 'secondary', 
    icon: Clock,
    description: 'La demande est en cours de rédaction, visible uniquement par le magasin.'
  },
  envoyee: { 
    label: 'Envoyée', 
    variant: 'warning', 
    icon: Send,
    description: 'La demande a été soumise au dépôt et attend une décision.'
  },
  approuvee: { 
    label: 'Approuvée', 
    variant: 'success', 
    icon: CheckCircle,
    description: 'Le dépôt a approuvé toutes les quantités demandées.'
  },
  partiellement_approuvee: { 
    label: 'Partiellement approuvée', 
    variant: 'info', 
    icon: CheckCircle,
    description: 'Le dépôt a approuvé une partie des quantités demandées.'
  },
  refusee: { 
    label: 'Refusée', 
    variant: 'destructive', 
    icon: XCircle,
    description: 'Le dépôt a refusé la demande.'
  },
  en_cours: { 
    label: 'En cours de livraison', 
    variant: 'warning', 
    icon: Package,
    description: 'Le transfert a été créé et le stock est en cours de préparation.'
  },
  livree: { 
    label: 'Livrée', 
    variant: 'success', 
    icon: Check,
    description: 'Le stock a été transféré du dépôt vers le magasin.'
  },
  cloturee: { 
    label: 'Clôturée', 
    variant: 'default', 
    icon: CheckCircle,
    description: 'Le magasin a confirmé la réception. Demande terminée.'
  },
};

export default function DemandeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useAuth();
  const { hasPermission, userRole } = usePermission();

  const [demande, setDemande] = useState<DemandeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDecisionDialog, setShowDecisionDialog] = useState(false);
  const [showClotureDialog, setShowClotureDialog] = useState(false);

  const isMagasin = userRole === 'magasin_staff' || userRole === 'caissier';
  const isDepot = userRole === 'depot_staff';
  const isAdmin = userRole === 'admin';

  useEffect(() => {
    if (id) loadDemande();
  }, [id]);

  const loadDemande = async () => {
    setLoading(true);
    try {
      const response = await demandeService.getById(parseInt(id!, 10));
      setDemande(response.data || response);
    } catch (error: any) {
      toast.error('Erreur lors du chargement de la demande');
      navigate('/demandes');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: string, payload?: any) => {
    if (!demande) return;
    setActionLoading(action);

    try {
      switch (action) {
        case 'send':
          await demandeService.send(demande.id);
          toast.success('Demande envoyée au dépôt');
          break;
        case 'execute':
          await demandeService.execute(demande.id);
          toast.success('Transfert exécuté avec succès');
          break;
        case 'cancel':
          await demandeService.cancel(demande.id);
          toast.success('Demande annulée');
          navigate('/demandes');
          break;
        case 'decide':
          await demandeService.decide(demande.id, payload);
          toast.success(`Demande ${payload.decision === 'approuvee' ? 'approuvée' : 'refusée'}`);
          setShowDecisionDialog(false);
          break;
        case 'close':
          await demandeService.close(demande.id);
          toast.success('Demande clôturée');
          setShowClotureDialog(false);
          break;
      }
      await loadDemande();
    } catch (error: any) {
      toast.error(error.response?.data?.error || `Erreur lors de l'action`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!demande) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
        <p>Demande non trouvée</p>
        <Button onClick={() => navigate('/demandes')} className="mt-4">
          Retour à la liste
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[demande.statut];
  const StatusIcon = statusConfig.icon;

  // Determine available actions based on role and state
  const canSend = (isMagasin || isAdmin) && demande.statut === 'brouillon' && hasPermission(Permissions.DEMANDE_SEND);
  const canDecide = (isDepot || isAdmin) && demande.statut === 'envoyee' && hasPermission(Permissions.DEMANDE_DECIDE);
  const canExecute = (isDepot || isAdmin) && ['approuvee', 'partiellement_approuvee'].includes(demande.statut) && hasPermission(Permissions.DEMANDE_EXECUTE);
  const canClose = (isMagasin || isAdmin) && demande.statut === 'livree' && hasPermission(Permissions.DEMANDE_CLOSE);
  const canCancel = (isMagasin || isAdmin) && ['brouillon', 'envoyee'].includes(demande.statut) && hasPermission(Permissions.DEMANDE_CANCEL);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/demandes')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{demande.numero}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusConfig.variant} className="gap-1">
              <StatusIcon className="h-3 w-3" />
              {statusConfig.label}
            </Badge>
            {demande.numero_transfer && (
              <Badge variant="outline" className="gap-1">
                <Package className="h-3 w-3" />
                {demande.numero_transfer}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Status Description */}
      <Card className="bg-muted/50 border-none">
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">{statusConfig.description}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lignes de demande</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-sm font-medium">Produit</th>
                    <th className="text-center py-2 text-sm font-medium">Demandée</th>
                    <th className="text-center py-2 text-sm font-medium">Approuvée</th>
                    <th className="text-center py-2 text-sm font-medium">Livrée</th>
                  </tr>
                </thead>
                <tbody>
                  {demande.lignes.map((ligne) => (
                    <tr key={ligne.id} className="border-b last:border-0">
                      <td className="py-3">
                        <div className="font-medium">{ligne.produit_nom}</div>
                        <div className="text-xs text-muted-foreground">{ligne.reference}</div>
                        {ligne.notes && (
                          <div className="text-xs text-muted-foreground mt-1">{ligne.notes}</div>
                        )}
                      </td>
                      <td className="text-center py-3">{ligne.quantite_demandee}</td>
                      <td className="text-center py-3">
                        {ligne.quantite_approuvee !== null ? (
                          <span className={ligne.quantite_approuvee < ligne.quantite_demandee ? 'text-warning font-medium' : ''}>
                            {ligne.quantite_approuvee}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="text-center py-3">
                        {ligne.quantite_livree !== null ? ligne.quantite_livree : <span className="text-muted-foreground">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" />
                Historique
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {demande.historique.map((entry, index) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                      {index !== demande.historique.length - 1 && (
                        <div className="absolute top-3 left-1 w-px h-full bg-border -translate-x-1/2" />
                      )}
                    </div>
                    <div className="flex-1 pb-3">
                      <div className="text-sm">
                        <span className="font-medium">
                          {entry.from_statut 
                            ? `${STATUS_CONFIG[entry.from_statut]?.label || entry.from_statut} → ${STATUS_CONFIG[entry.to_statut]?.label || entry.to_statut}`
                            : `Création → ${STATUS_CONFIG[entry.to_statut]?.label || entry.to_statut}`
                          }
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        par {entry.nom_complet || entry.username || 'Système'} • {new Date(entry.timestamp).toLocaleString('fr-FR')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Magasin</div>
                  <div className="text-sm text-muted-foreground">{demande.magasin_nom} ({demande.magasin_code})</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Dépôt</div>
                  <div className="text-sm text-muted-foreground">{demande.depot_nom} ({demande.depot_code})</div>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Créée par</div>
                  <div className="text-sm text-muted-foreground">{demande.created_by_nom}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(demande.date_creation).toLocaleString('fr-FR')}
                  </div>
                </div>
              </div>
              {demande.date_envoi && (
                <div className="flex items-start gap-2">
                  <Send className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Envoyée le</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(demande.date_envoi).toLocaleString('fr-FR')}
                    </div>
                  </div>
                </div>
              )}
              {demande.decided_by_nom && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Décision par</div>
                    <div className="text-sm text-muted-foreground">{demande.decided_by_nom}</div>
                    {demande.date_decision && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(demande.date_decision).toLocaleString('fr-FR')}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {demande.raison_refus && (
                <div className="bg-destructive/10 p-3 rounded-md">
                  <div className="text-sm font-medium text-destructive">Motif de refus</div>
                  <div className="text-sm text-destructive/80">{demande.raison_refus}</div>
                </div>
              )}
              {demande.motif && (
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Notes</div>
                    <div className="text-sm text-muted-foreground">{demande.motif}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {canSend && (
                <Button 
                  className="w-full gap-2" 
                  onClick={() => handleAction('send')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer au dépôt
                </Button>
              )}
              
              {canDecide && (
                <Button 
                  className="w-full gap-2" 
                  onClick={() => setShowDecisionDialog(true)}
                >
                  <CheckCircle className="h-4 w-4" />
                  Prendre une décision
                </Button>
              )}

              {canExecute && (
                <Button 
                  className="w-full gap-2" 
                  onClick={() => handleAction('execute')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'execute' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                  Exécuter le transfert
                </Button>
              )}

              {canClose && (
                <Button 
                  className="w-full gap-2" 
                  onClick={() => setShowClotureDialog(true)}
                >
                  <Check className="h-4 w-4" />
                  Clôturer la demande
                </Button>
              )}

              {canCancel && (
                <Button 
                  variant="outline" 
                  className="w-full gap-2 text-destructive hover:text-destructive" 
                  onClick={() => {
                    if (confirm('Êtes-vous sûr de vouloir annuler cette demande ?')) {
                      handleAction('cancel');
                    }
                  }}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Annuler
                </Button>
              )}

              {!canSend && !canDecide && !canExecute && !canClose && !canCancel && (
                <div className="text-sm text-muted-foreground text-center py-2">
                  Aucune action disponible pour cette demande
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      {showDecisionDialog && (
        <DemandeDecisionDialog
          demande={demande}
          onClose={() => setShowDecisionDialog(false)}
          onSubmit={(payload) => handleAction('decide', payload)}
          loading={actionLoading === 'decide'}
        />
      )}

      {showClotureDialog && (
        <DemandeClotureDialog
          demande={demande}
          onClose={() => setShowClotureDialog(false)}
          onSubmit={() => handleAction('close')}
          loading={actionLoading === 'close'}
        />
      )}
    </div>
  );
}
