import { useEffect, useState } from 'react';
import { formatFCFA as formatXOF } from '../utils/format';
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
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  Receipt, 
  Plus, 
  Trash2, 
  Store,
  AlertCircle,
  Link as LinkIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

interface Magasin {
  id: number;
  code: string;
  nom: string;
}

interface CategorieDepense {
  id: number;
  code: string;
  nom: string;
}

interface Depense {
  id: number;
  numero_depense: string;
  magasin_id: number;
  magasin_nom: string;
  categorie_nom: string;
  montant: number;
  methode_paiement: string;
  date_depense: string;
  description: string;
  beneficiaire_libre: string | null;
  fournisseur_nom: string | null;
  username: string;
  session_caisse_id: number | null;
}

interface SessionCaisse {
  id: number;
  statut: 'ouverte' | 'cloturee';
}

export default function DepensesV2() {
  useAuth();
  const [magasins, setMagasins] = useState<Magasin[]>([]);
  const [selectedMagasin, setSelectedMagasin] = useState<number | null>(null);
  const [sessionActive, setSessionActive] = useState<SessionCaisse | null>(null);
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [categories, setCategories] = useState<CategorieDepense[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalDepenses, setTotalDepenses] = useState(0);
  
  // Dialog
  const [openDialog, setOpenDialog] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    montant: '',
    categorie_id: '',
    description: '',
    methode_paiement: 'espece',
    beneficiaire_libre: '',
    fournisseur_id: '',
    date_depense: new Date().toISOString().split('T')[0],
  });

  // Load magasins and categories on mount
  useEffect(() => {
    loadMagasins();
    loadCategories();
  }, []);

  // Load session and depenses when magasin changes
  useEffect(() => {
    if (selectedMagasin) {
      loadSessionActive(selectedMagasin);
      loadDepenses();
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
        if (data.data.length === 1) {
          setSelectedMagasin(data.data[0].id);
        } else {
          // More than one magasin — user must pick one; stop spinner
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (error) {
      toast.error('Erreur lors du chargement des magasins');
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('/api/depenses/categories/list', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadSessionActive = async (magasinId: number) => {
    try {
      const response = await fetch(`/api/caisse/session-active?magasin_id=${magasinId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setSessionActive(data.data);
      }
    } catch (error) {
      console.error('Error loading session:', error);
    }
  };

  const loadDepenses = async () => {
    if (!selectedMagasin) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `/api/depenses?magasin_id=${selectedMagasin}&limit=100`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }}
      );
      const data = await response.json();
      
      if (data.success) {
        setDepenses(data.data);
        setTotalDepenses(data.data.reduce((sum: number, d: Depense) => sum + d.montant, 0));
      }
    } catch (error) {
      toast.error('Erreur lors du chargement des dépenses');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedMagasin) {
      toast.error('Sélectionnez un magasin');
      return;
    }

    if (!formData.montant || !formData.categorie_id || !formData.description) {
      toast.error('Veuillez remplir les champs obligatoires');
      return;
    }

    // Check caisse if paying by cash
    if (formData.methode_paiement === 'espece' && !sessionActive) {
      toast.error(
        <div className="flex flex-col gap-2">
          <span>Caisse fermée — ouvrez la caisse du magasin avant d'enregistrer cette dépense.</span>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => window.location.href = '/caisse'}
            className="w-fit"
          >
            Ouvrir la caisse →
          </Button>
        </div>,
        { duration: 5000 }
      );
      return;
    }

    try {
      const response = await fetch('/api/depenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          magasin_id: selectedMagasin,
          montant: parseFloat(formData.montant),
          categorie_id: parseInt(formData.categorie_id),
          methode_paiement: formData.methode_paiement,
          description: formData.description,
          beneficiaire_libre: formData.beneficiaire_libre || undefined,
          date_depense: formData.date_depense
        })
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Dépense créée avec succès');
        setOpenDialog(false);
        resetForm();
        loadDepenses();
        // Refresh session to update balance
        loadSessionActive(selectedMagasin);
      } else {
        if (response.status === 422 && data.code === 'CAISSE_FERMEE') {
          toast.error(
            <div className="flex flex-col gap-2">
              <span>{data.error}</span>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => window.location.href = '/caisse'}
                className="w-fit"
              >
                Ouvrir la caisse →
              </Button>
            </div>,
            { duration: 5000 }
          );
        } else {
          toast.error(data.error || 'Erreur lors de la création');
        }
      }
    } catch (error) {
      toast.error('Erreur réseau');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette dépense ?')) return;

    try {
      const response = await fetch(`/api/depenses/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });

      if (response.ok) {
        toast.success('Dépense supprimée');
        loadDepenses();
        if (selectedMagasin) {
          loadSessionActive(selectedMagasin);
        }
      } else {
        const data = await response.json();
        toast.error(data.error || 'Erreur lors de la suppression');
      }
    } catch (error) {
      toast.error('Erreur réseau');
    }
  };

  const resetForm = () => {
    setFormData({
      montant: '',
      categorie_id: '',
      description: '',
      methode_paiement: 'espece',
      beneficiaire_libre: '',
      fournisseur_id: '',
      date_depense: new Date().toISOString().split('T')[0],
    });
  };


  const getMethodBadge = (methode: string) => {
    const colors: Record<string, string> = {
      'espece': 'bg-green-100 text-green-800',
      'carte': 'bg-blue-100 text-blue-800',
      'cheque': 'bg-orange-100 text-orange-800',
      'virement': 'bg-purple-100 text-purple-800',
      'mobile_money': 'bg-pink-100 text-pink-800'
    };
    const labels: Record<string, string> = {
      'espece': 'Espèces',
      'carte': 'Carte',
      'cheque': 'Chèque',
      'virement': 'Virement',
      'mobile_money': 'Mobile Money'
    };
    return (
      <Badge className={colors[methode] || 'bg-gray-100'}>
        {labels[methode] || methode}
      </Badge>
    );
  };

  const isCashPayment = formData.methode_paiement === 'espece';

  return (
    <div className="container mx-auto py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dépenses</h1>
          <p className="text-muted-foreground text-sm">
            Gestion des dépenses par magasin
          </p>
        </div>
        
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

      {/* Caisse status alert */}
      {selectedMagasin && (
        <Card className={`p-4 mb-6 ${sessionActive ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {sessionActive ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-800 font-medium">
                    Caisse ouverte — Les dépenses en espèces seront enregistrées
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-800 font-medium">
                    Caisse fermée — Ouvrez la caisse pour enregistrer des dépenses en espèces
                  </span>
                </>
              )}
            </div>
            {!sessionActive && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => window.location.href = '/caisse'}
              >
                Ouvrir la caisse
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* KPI */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-red-600" />
            <div>
              <p className="text-sm text-muted-foreground">Total dépenses</p>
              <p className="text-2xl font-bold">{formatXOF(totalDepenses)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div>
            <p className="text-sm text-muted-foreground">Nombre de dépenses</p>
            <p className="text-2xl font-bold">{depenses.length}</p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex justify-end">
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <Button onClick={() => setOpenDialog(true)} disabled={!selectedMagasin}>
                <Plus className="h-4 w-4 mr-2" />
                Nouvelle Dépense
              </Button>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Créer une dépense</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Cash warning */}
                  {isCashPayment && !sessionActive && (
                    <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                      <div>
                        <p className="text-amber-800 font-medium">Caisse fermée</p>
                        <p className="text-amber-700 text-sm">
                          La caisse de ce magasin n'est pas ouverte. 
                          <Button 
                            variant="link" 
                            className="p-0 h-auto text-amber-800 underline"
                            onClick={() => { setOpenDialog(false); window.location.href = '/caisse'; }}
                          >
                            Ouvrir la caisse →
                          </Button>
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Cash info */}
                  {isCashPayment && sessionActive && (
                    <div className="bg-green-50 border border-green-200 p-3 rounded-lg flex items-start gap-2">
                      <LinkIcon className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="text-green-800 font-medium">Cette dépense sera liée à la caisse</p>
                        <p className="text-green-700 text-sm">
                          Elle décrémentera le solde de la caisse ouverte du magasin.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Date *</Label>
                      <Input
                        type="date"
                        value={formData.date_depense}
                        onChange={(e) => setFormData({...formData, date_depense: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label>Montant *</Label>
                      <MoneyInput
                        value={formData.montant}
                        onChange={(v) => setFormData({...formData, montant: v})}
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Catégorie *</Label>
                    <select
                      value={formData.categorie_id}
                      onChange={(e) => setFormData({...formData, categorie_id: e.target.value})}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Sélectionner une catégorie</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.nom}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label>Mode de paiement *</Label>
                    <select
                      value={formData.methode_paiement}
                      onChange={(e) => setFormData({...formData, methode_paiement: e.target.value})}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="espece">Espèces (décrémente la caisse)</option>
                      <option value="carte">Carte bancaire</option>
                      <option value="cheque">Chèque</option>
                      <option value="virement">Virement</option>
                      <option value="mobile_money">Mobile Money</option>
                    </select>
                  </div>

                  <div>
                    <Label>Bénéficiaire</Label>
                    <Input
                      value={formData.beneficiaire_libre}
                      onChange={(e) => setFormData({...formData, beneficiaire_libre: e.target.value})}
                      placeholder="Nom du bénéficiaire (optionnel)"
                    />
                  </div>

                  <div>
                    <Label>Description *</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      placeholder="Description de la dépense"
                    />
                  </div>

                  <Button 
                    onClick={handleCreate} 
                    className="w-full"
                    disabled={isCashPayment && !sessionActive}
                  >
                    Créer la dépense
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </Card>
      </div>

      {/* Depenses list */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numéro</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Bénéficiaire</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead className="text-center">Caisse</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  Chargement...
                </TableCell>
              </TableRow>
            ) : depenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {selectedMagasin ? 'Aucune dépense trouvée' : 'Sélectionnez un magasin'}
                </TableCell>
              </TableRow>
            ) : (
              depenses.map((depense) => (
                <TableRow key={depense.id}>
                  <TableCell className="font-medium">{depense.numero_depense}</TableCell>
                  <TableCell>
                    {new Date(depense.date_depense).toLocaleDateString('fr-FR')}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{depense.categorie_nom}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {depense.fournisseur_nom || depense.beneficiaire_libre || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {depense.description}
                  </TableCell>
                  <TableCell>{getMethodBadge(depense.methode_paiement)}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    -{formatXOF(depense.montant)}
                  </TableCell>
                  <TableCell className="text-center">
                    {depense.session_caisse_id ? (
                      <LinkIcon className="h-4 w-4 text-green-600 mx-auto" aria-label="Liée à la caisse" />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(depense.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
