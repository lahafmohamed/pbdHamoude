import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Scale,
  Store,
  AlertCircle,
  Lock,
  ArrowLeftRight,
  History,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { formatFCFA as formatXOF } from '../utils/format';

interface Magasin {
  id: number;
  code: string;
  nom: string;
}

interface SessionCaisse {
  id: number;
  magasin_id: number;
  magasin_nom: string;
  magasin_code: string;
  date_ouverture: string;
  fond_initial: number;
  total_encaissements: number;
  total_decaissements: number;
  solde_theorique: number;
  statut: 'ouverte' | 'cloturee';
  ouvert_par_username: string;
}

interface MouvementCaisse {
  id: number;
  date_mouvement: string;
  type: 'encaissement' | 'decaissement';
  categorie: string;
  montant: number;
  methode_paiement: string;
  libelle: string;
  reference_type?: string;
  reference_id?: number;
  solde_apres: number;
  cree_par_username?: string;
}

interface ClosurePreview {
  session_id: number;
  fond_initial: number;
  expected_cash: number;
  fond_final_compte: number | null;
  ecart: number | null;
  par_methode: Array<{
    methode_paiement: string;
    total_encaissements: number;
    total_decaissements: number;
    nb: number;
  }>;
  orphan_mouvements: Array<{
    id: number;
    categorie: string;
    montant: number;
    libelle: string;
  }>;
  can_close: boolean;
}

export default function CaisseV2() {
  const [magasins, setMagasins] = useState<Magasin[]>([]);
  const [selectedMagasin, setSelectedMagasin] = useState<number | null>(null);
  const [session, setSession] = useState<SessionCaisse | null>(null);
  const [mouvements, setMouvements] = useState<MouvementCaisse[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dialogs
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [mouvementsDialog, setMouvementsDialog] = useState(false);
  
  // Form states
  const [fondInitial, setFondInitial] = useState('');
  const [fondFinal, setFondFinal] = useState('');
  const [commentaireCloture, setCommentaireCloture] = useState('');
  const [commentaireOuverture, setCommentaireOuverture] = useState('');

  // Closure preview
  const [closurePreview, setClosurePreview] = useState<ClosurePreview | null>(null);

  // Divers movement dialog
  const [diversDialog, setDiversDialog] = useState(false);
  const [diversType, setDiversType] = useState<'encaissement' | 'decaissement'>('encaissement');
  const [diversCategorie, setDiversCategorie] = useState('apport');
  const [diversMontant, setDiversMontant] = useState('');
  const [diversLibelle, setDiversLibelle] = useState('');
  const [diversMethode, setDiversMethode] = useState('espece');

  // Load magasins on mount
  useEffect(() => {
    loadMagasins();
  }, []);

  // Load session when magasin changes
  useEffect(() => {
    if (selectedMagasin) {
      loadSession(selectedMagasin);
    }
  }, [selectedMagasin]);

  const loadMagasins = async () => {
    try {
      const response = await fetch('/api/caisse/magasins', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setMagasins(data.data);
        // Auto-select if only one magasin
        if (data.data.length === 1) {
          setSelectedMagasin(data.data[0].id);
        }
      } else {
        toast.error(data.error || 'Erreur lors du chargement des magasins');
      }
    } catch (error) {
      toast.error('Erreur lors du chargement des magasins');
    }
  };

  const loadSession = async (magasinId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/caisse/session-active?magasin_id=${magasinId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setSession(data.data);
        if (data.data?.id) {
          loadMouvements(data.data.id);
        } else {
          setMouvements([]);
        }
      } else {
        toast.error(data.error || 'Erreur lors du chargement de la caisse');
      }
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors du chargement de la caisse');
    } finally {
      setLoading(false);
    }
  };

  const loadMouvements = async (sessionId: number) => {
    try {
      const response = await fetch(`/api/caisse/${sessionId}/mouvements`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setMouvements(data.data);
      }
    } catch (error) {
      console.error('Erreur chargement mouvements:', error);
    }
  };

  const handleOpenSession = async () => {
    if (!selectedMagasin || !fondInitial) {
      toast.error('Veuillez saisir le fond de caisse initial');
      return;
    }

    try {
      const response = await fetch('/api/caisse/ouvrir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          magasin_id: selectedMagasin,
          fond_initial: parseFloat(fondInitial),
          commentaire_ouverture: commentaireOuverture
        })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Caisse ouverte avec succès');
        setOpenDialog(false);
        setFondInitial('');
        setCommentaireOuverture('');
        loadSession(selectedMagasin);
      } else {
        if (response.status === 409) {
          toast.error('Une caisse est déjà ouverte pour ce magasin');
        } else if (response.status === 403) {
          toast.error('Accès refusé');
        } else {
          toast.error(data.error || 'Erreur lors de l\'ouverture');
        }
      }
    } catch (error) {
      toast.error('Erreur réseau');
    }
  };

  const loadClosurePreview = async (sessionId: number, fondFinalNum?: number) => {
    try {
      const qs = fondFinalNum !== undefined ? `?fond_final_compte=${fondFinalNum}` : '';
      const r = await fetch(`/api/caisse/cloture-preview/${sessionId}${qs}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const d = await r.json();
      if (d.success) setClosurePreview(d.data);
      else toast.error(d.error || 'Erreur preview');
    } catch (e: any) {
      toast.error(e.message || 'Erreur preview');
    }
  };

  const openCloseDialog = async () => {
    if (!session?.id) return;
    await loadClosurePreview(session.id);
    setCloseDialog(true);
  };

  // Refresh preview when fondFinal changes
  useEffect(() => {
    if (closeDialog && session?.id && fondFinal) {
      const n = parseFloat(fondFinal);
      if (!Number.isNaN(n)) loadClosurePreview(session.id, n);
    }
  }, [fondFinal, closeDialog, session?.id]);

  const handleCloseSession = async () => {
    if (!session?.id || !fondFinal) {
      toast.error('Comptage final requis');
      return;
    }
    if (!closurePreview?.can_close) {
      toast.error('Mouvements orphelins — régularisez avant clôture');
      return;
    }

    const fondFinalNum = parseFloat(fondFinal);
    const ecartLive = closurePreview?.ecart ?? null;
    if (ecartLive !== null && ecartLive !== 0 && !commentaireCloture.trim()) {
      toast.error(`Écart de ${formatXOF(ecartLive)} — commentaire obligatoire`);
      return;
    }

    try {
      const response = await fetch(`/api/caisse/cloturer/${session.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          fond_final_compte: fondFinalNum,
          commentaire_cloture: commentaireCloture
        })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        setCloseDialog(false);
        setFondFinal('');
        setCommentaireCloture('');
        setClosurePreview(null);
        loadSession(selectedMagasin!);
      } else {
        toast.error(data.error || 'Erreur lors de la clôture');
      }
    } catch (error) {
      toast.error('Erreur réseau');
    }
  };

  const handleDiversSubmit = async () => {
    if (!session?.id) return;
    if (!diversMontant || parseFloat(diversMontant) <= 0) {
      toast.error('Montant > 0 obligatoire');
      return;
    }
    if (!diversLibelle || diversLibelle.trim().length < 3) {
      toast.error('Motif obligatoire (≥3 caractères)');
      return;
    }
    try {
      const r = await fetch(`/api/caisse/${session.id}/mouvement-divers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          type: diversType,
          categorie: diversCategorie,
          montant: parseFloat(diversMontant),
          methode_paiement: diversMethode,
          libelle: diversLibelle.trim(),
          idempotency_key: `divers-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        })
      });
      const d = await r.json();
      if (r.ok) {
        toast.success('Mouvement enregistré');
        setDiversDialog(false);
        setDiversMontant('');
        setDiversLibelle('');
        loadSession(selectedMagasin!);
      } else {
        toast.error(d.error || 'Erreur');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur réseau');
    }
  };


  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTypeBadge = (type: string) => {
    if (type === 'encaissement') {
      return <Badge className="bg-green-100 text-green-800">Entrée</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800">Sortie</Badge>;
  };

  const getCategorieLabel = (categorie: string) => {
    const labels: Record<string, string> = {
      'paiement_client': 'Paiement client',
      'acompte_client': 'Acompte client',
      'apport': 'Apport',
      'autre_entree': 'Autre entrée',
      'depense': 'Dépense',
      'paiement_fournisseur': 'Paiement fournisseur',
      'retrait_banque': 'Retrait banque',
      'remboursement_client': 'Remboursement',
      'autre_sortie': 'Autre sortie'
    };
    return labels[categorie] || categorie;
  };

  // ecart now sourced from closurePreview (server-side)

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Caisse</h1>
          <p className="text-muted-foreground text-sm">
            Gestion des caisses par magasin
          </p>
        </div>
        
        {/* Magasin Selector */}
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedMagasin || ''}
            onChange={(e) => setSelectedMagasin(e.target.value ? parseInt(e.target.value) : null)}
            className="h-9 w-[200px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sélectionner un magasin</option>
            {magasins.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} - {m.nom}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* No magasin selected */}
      {!selectedMagasin && (
        <Card className="p-12 text-center">
          <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Sélectionnez un magasin</h3>
          <p className="text-muted-foreground">
            Choisissez un magasin pour voir ou gérer sa caisse
          </p>
        </Card>
      )}

      {/* Caisse fermée */}
      {selectedMagasin && !session && !loading && (
        <Card className="p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Lock className="h-8 w-8 text-gray-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Caisse fermée</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              La caisse de ce magasin n'est pas ouverte. Pour enregistrer des transactions en espèces, vous devez d'abord ouvrir la caisse.
            </p>
            <Button onClick={() => setOpenDialog(true)} size="lg">
              <Plus className="h-4 w-4 mr-2" />
              Ouvrir la caisse
            </Button>
          </div>
        </Card>
      )}

      {/* Caisse ouverte */}
      {selectedMagasin && session && (
        <>
          {/* Status bar */}
          <Card className="p-4 mb-6 bg-green-50 border-green-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <div>
                  <span className="font-semibold text-green-900">Caisse ouverte</span>
                  <span className="text-green-700 text-sm ml-2">
                    depuis {formatDateTime(session.date_ouverture)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-green-800">
                <span>Fond initial : {formatXOF(session.fond_initial)}</span>
                <span>|</span>
                <span>Ouverte par : {session.ouvert_par_username}</span>
              </div>
            </div>
          </Card>

          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Encaissements</p>
                  <p className="text-xl font-bold text-green-600">
                    {formatXOF(session.total_encaissements)}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Décaissements</p>
                  <p className="text-xl font-bold text-red-600">
                    {formatXOF(session.total_decaissements)}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Scale className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Solde théorique</p>
                  <p className="text-xl font-bold text-blue-600">
                    {formatXOF(session.solde_theorique)}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <ArrowLeftRight className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Mouvements</p>
                  <p className="text-xl font-bold">{mouvements.length}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Mouvements de la session</h2>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setMouvementsDialog(true)}
              >
                <Eye className="h-4 w-4 mr-2" />
                Voir tout
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {/* TODO: Navigate to historique */}}
              >
                <History className="h-4 w-4 mr-2" />
                Historique
              </Button>
              <Button
                variant="outline"
                onClick={() => setDiversDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Mouvement divers
              </Button>
              <Button
                variant="default"
                onClick={openCloseDialog}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Lock className="h-4 w-4 mr-2" />
                Clôturer la caisse
              </Button>
            </div>
          </div>

          {/* Movements table */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Heure</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Méthode</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">Solde après</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mouvements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Aucun mouvement enregistré aujourd'hui
                    </TableCell>
                  </TableRow>
                ) : (
                  mouvements.slice(0, 10).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        {new Date(m.date_mouvement).toLocaleTimeString('fr-FR')}
                      </TableCell>
                      <TableCell>{getTypeBadge(m.type)}</TableCell>
                      <TableCell className="text-sm">
                        {getCategorieLabel(m.categorie)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">{m.methode_paiement}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {m.libelle}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={m.type === 'encaissement' ? 'text-green-600' : 'text-red-600'}>
                          {m.type === 'encaissement' ? '+' : '-'}{formatXOF(m.montant)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatXOF(m.solde_apres)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {mouvements.length > 10 && (
              <div className="p-4 text-center border-t">
                <Button variant="ghost" onClick={() => setMouvementsDialog(true)}>
                  Voir les {mouvements.length - 10} mouvements supplémentaires
                </Button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Open Session Dialog */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ouvrir la caisse</DialogTitle>
            <DialogDescription>
              Saisissez le fond de caisse initial (comptage physique des espèces)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Fond de caisse initial *</Label>
              <MoneyInput
                value={fondInitial}
                onChange={(v) => setFondInitial(v)}
                placeholder="50 000"
                className="mt-1"
              />
              <p className="text-sm text-muted-foreground mt-1">
                Montant physique compté en début de journée
              </p>
            </div>
            <div>
              <Label>Commentaire (optionnel)</Label>
              <Input
                value={commentaireOuverture}
                onChange={(e) => setCommentaireOuverture(e.target.value)}
                placeholder="Ex: Fond de caisse standard"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              Annuler
            </Button>
            <Button onClick={handleOpenSession} disabled={!fondInitial}>
              Ouvrir la caisse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Session Dialog */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Clôturer la caisse</DialogTitle>
            <DialogDescription>
              L'écart est calculé sur les espèces uniquement. Les autres méthodes sont affichées pour audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Orphans block */}
            {closurePreview && closurePreview.orphan_mouvements.length > 0 && (
              <div className="p-3 rounded-lg bg-red-100 text-red-800 border border-red-300">
                <div className="flex items-center gap-2 font-semibold mb-2">
                  <AlertCircle className="h-4 w-4" />
                  {closurePreview.orphan_mouvements.length} mouvement(s) sans source — clôture bloquée
                </div>
                <ul className="text-sm list-disc ml-5">
                  {closurePreview.orphan_mouvements.slice(0, 5).map((o) => (
                    <li key={o.id}>#{o.id} {o.categorie} {formatXOF(o.montant)} — {o.libelle}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Per-method breakdown */}
            {closurePreview && (
              <div className="bg-muted p-3 rounded-lg space-y-1 text-sm">
                <div className="flex justify-between font-semibold border-b pb-1">
                  <span>Méthode</span>
                  <span>Encaissé / Décaissé</span>
                </div>
                {closurePreview.par_methode.map((p) => (
                  <div key={p.methode_paiement} className="flex justify-between">
                    <span>{p.methode_paiement} <span className="text-xs text-muted-foreground">({p.nb})</span></span>
                    <span>
                      <span className="text-green-600">+{formatXOF(p.total_encaissements)}</span>
                      {' / '}
                      <span className="text-red-600">-{formatXOF(p.total_decaissements)}</span>
                    </span>
                  </div>
                ))}
                {closurePreview.par_methode.length === 0 && (
                  <div className="text-muted-foreground italic">Aucun mouvement</div>
                )}
              </div>
            )}

            {/* Cash expected */}
            {closurePreview && (
              <div className="bg-muted p-3 rounded-lg space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Fond initial (espèces) :</span>
                  <span>{formatXOF(closurePreview.fond_initial)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-semibold">
                  <span>Espèces attendues :</span>
                  <span>{formatXOF(closurePreview.expected_cash)}</span>
                </div>
              </div>
            )}

            {/* Count input */}
            <div>
              <Label>Comptage physique espèces *</Label>
              <MoneyInput
                value={fondFinal}
                onChange={(v) => setFondFinal(v)}
                placeholder="0"
                className="mt-1"
              />
            </div>

            {/* Ecart display */}
            {fondFinal && closurePreview?.ecart !== null && closurePreview && (
              <div className={`p-3 rounded-md border ${
                closurePreview.ecart === 0 ? 'bg-success-50 border-success-200 text-success-800' :
                Math.abs(closurePreview.ecart!) < 5000 ? 'bg-warning-50 border-warning-200 text-warning-800' :
                'bg-danger-50 border-danger-200 text-danger-800'
              }`}>
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4" />
                  Écart espèces : {closurePreview.ecart! > 0 ? '+' : ''}{formatXOF(closurePreview.ecart!)}
                </div>
                {closurePreview.ecart === 0 ? (
                  <p className="text-sm mt-1">Écart nul — clôture conforme.</p>
                ) : (
                  <p className="text-sm mt-1">Commentaire obligatoire pour expliquer l'écart.</p>
                )}
              </div>
            )}

            {/* Comment */}
            <div>
              <Label>
                Commentaire {closurePreview?.ecart !== 0 && closurePreview?.ecart !== null && <span className="text-red-500">*</span>}
              </Label>
              <Input
                value={commentaireCloture}
                onChange={(e) => setCommentaireCloture(e.target.value)}
                placeholder={closurePreview?.ecart !== 0 ? "Expliquer l'écart..." : "Commentaire optionnel..."}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleCloseSession}
              disabled={
                !fondFinal
                || !closurePreview?.can_close
                || (closurePreview?.ecart !== 0 && closurePreview?.ecart !== null && !commentaireCloture.trim())
              }
              className="bg-warning-600 hover:bg-warning-700"
            >
              Confirmer la clôture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mouvement divers Dialog */}
      <Dialog open={diversDialog} onOpenChange={setDiversDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mouvement divers</DialogTitle>
            <DialogDescription>
              Apport, retrait banque, autre entrée/sortie. Motif obligatoire.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <select
                  value={diversType}
                  onChange={(e) => {
                    const v = e.target.value as 'encaissement' | 'decaissement';
                    setDiversType(v);
                    setDiversCategorie(v === 'encaissement' ? 'apport' : 'retrait_banque');
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="encaissement">Entrée</option>
                  <option value="decaissement">Sortie</option>
                </select>
              </div>
              <div>
                <Label>Catégorie</Label>
                <select
                  value={diversCategorie}
                  onChange={(e) => setDiversCategorie(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {diversType === 'encaissement' ? (
                    <>
                      <option value="apport">Apport</option>
                      <option value="autre_entree">Autre entrée</option>
                    </>
                  ) : (
                    <>
                      <option value="retrait_banque">Retrait banque</option>
                      <option value="autre_sortie">Autre sortie</option>
                    </>
                  )}
                </select>
              </div>
            </div>
            <div>
              <Label>Méthode</Label>
              <select
                value={diversMethode}
                onChange={(e) => setDiversMethode(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="espece">Espèces</option>
                <option value="carte">Carte</option>
                <option value="cheque">Chèque</option>
                <option value="virement">Virement</option>
                <option value="mobile_money">Mobile Money</option>
              </select>
            </div>
            <div>
              <Label>Montant *</Label>
              <MoneyInput
                value={diversMontant}
                onChange={(v) => setDiversMontant(v)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Motif *</Label>
              <Input
                value={diversLibelle}
                onChange={(e) => setDiversLibelle(e.target.value)}
                placeholder="Ex: Apport gérant, retrait dépôt banque..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiversDialog(false)}>Annuler</Button>
            <Button onClick={handleDiversSubmit}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All Movements Dialog */}
      <Dialog open={mouvementsDialog} onOpenChange={setMouvementsDialog}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Tous les mouvements de la session</DialogTitle>
            <DialogDescription>
              Session du {session && formatDateTime(session.date_ouverture)}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Heure</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Méthode</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">Solde après</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mouvements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">
                      {formatDateTime(m.date_mouvement)}
                    </TableCell>
                    <TableCell>{getTypeBadge(m.type)}</TableCell>
                    <TableCell className="text-sm">
                      {getCategorieLabel(m.categorie)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline">{m.methode_paiement}</Badge>
                    </TableCell>
                    <TableCell>{m.libelle}</TableCell>
                    <TableCell className="text-right font-medium">
                      <span className={m.type === 'encaissement' ? 'text-green-600' : 'text-red-600'}>
                        {m.type === 'encaissement' ? '+' : '-'}{formatXOF(m.montant)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatXOF(m.solde_apres)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
