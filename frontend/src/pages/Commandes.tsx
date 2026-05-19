import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { commandeService, produitService } from '../services/api';
import { useAuth } from '../lib/AuthContext';
import { TiersPicker } from '../components/TiersPicker';
import { Tiers } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, ShoppingCart, CheckCircle, Clock, Truck, XCircle, Package, Loader2 } from 'lucide-react';
import { normalizeSearch } from '@/utils/format';
import { toast } from 'sonner';

export default function Commandes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreate = ['admin', 'manager', 'depot_staff'].includes(user?.role || '');
  const [commandes, setCommandes] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [produits, setProduits] = useState<any[]>([]);
  const [selectedFournisseur, setSelectedFournisseur] = useState<Tiers | null>(null);
  const [produitSearch, setProduitSearch] = useState('');
  const [lignes, setLignes] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [dateLivraison, setDateLivraison] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadCommandes();
  }, [search, statusFilter]);

  const loadCommandes = async () => {
    setLoading(true);
    try {
      const statut = statusFilter === 'all' ? undefined : statusFilter;
      const data = await commandeService.getAll(normalizeSearch(search), statut);
      setCommandes(data);
    } catch (error) {
      toast.error('Erreur lors du chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (produitSearch.length >= 2) {
      produitService.searchFuzzy(produitSearch, 10, 0.1).then(setProduits).catch(console.error);
    } else {
      setProduits([]);
    }
  }, [produitSearch]);

  const addProduit = (produit: any) => {
    const exists = lignes.find((l) => l.produit_id === produit.id);
    if (exists) {
      toast.warning('Ce produit est déjà dans la commande');
      return;
    }
    setLignes([...lignes, {
      produit_id: produit.id,
      produit_nom: produit.nom,
      produit_reference: produit.reference,
      quantite: 1,
      prix_unitaire: parseFloat(produit.prix_achat) || 0,
    }]);
    setProduitSearch('');
    setProduits([]);
  };

  const updateQuantite = (index: number, quantite: number) => {
    const newLignes = [...lignes];
    newLignes[index].quantite = quantite;
    setLignes(newLignes);
  };

  const removeLigne = (index: number) => {
    setLignes(lignes.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFournisseur) {
      toast.error('Veuillez sélectionner un fournisseur');
      return;
    }
    if (lignes.length === 0) {
      toast.error('Veuillez ajouter au moins un produit');
      return;
    }

    setSubmitting(true);
    try {
      const result = await commandeService.create({
        tiers_id: selectedFournisseur!.id,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id,
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire,
        })),
        notes: notes || undefined,
        date_livraison_prevue: dateLivraison || undefined,
      });
      toast.success(`Commande ${result.numero_commande} créée avec succès!`);
      resetForm();
      loadCommandes();
    } catch (error) {
      toast.error('Erreur lors de la création de la commande');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setSelectedFournisseur(null);
    setLignes([]);
    setNotes('');
    setDateLivraison('');
    setProduitSearch('');
  };

  const updateStatut = async (id: number, statut: string) => {
    try {
      await commandeService.updateStatut(id, statut);
      loadCommandes();
      toast.success(statut === 'livree' ? 'Commande livrée et stock mis à jour!' : 'Statut mis à jour');
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const getStatutBadge = (statut: string) => {
    switch (statut) {
      case 'en_attente':
        return <Badge variant="warning" className="gap-1"><Clock className="h-3 w-3" /> En attente</Badge>;
      case 'validee':
        return <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" /> Validée</Badge>;
      case 'expediee':
        return <Badge className="gap-1 bg-blue-500"><Truck className="h-3 w-3" /> Expédiée</Badge>;
      case 'livree':
        return <Badge variant="success" className="gap-1"><Package className="h-3 w-3" /> Livrée</Badge>;
      case 'annulee':
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Annulée</Badge>;
      default:
        return <Badge variant="outline">{statut}</Badge>;
    }
  };

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-8 w-8" />
            Commandes Fournisseur
          </h1>
          <p className="text-muted-foreground mt-1">Gestion des commandes et livraisons</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouvelle Commande
          </Button>
        )}
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par numéro ou fournisseur..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tous les statuts</option>
              <option value="en_attente">En attente</option>
              <option value="validee">Validée</option>
              <option value="expediee">Expédiée</option>
              <option value="livree">Livrée</option>
              <option value="annulee">Annulée</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Create Order Modal */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvelle Commande Fournisseur</DialogTitle>
            <DialogDescription>Créez une commande pour réapprovisionner vos stocks</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Fournisseur *</Label>
                <TiersPicker role="fournisseur" value={selectedFournisseur} onChange={setSelectedFournisseur} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date_livraison">Date livraison prévue</Label>
                <Input
                  id="date_livraison"
                  type="date"
                  value={dateLivraison}
                  onChange={(e) => setDateLivraison(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="produit_search">Rechercher un produit</Label>
                <div className="relative">
                  <Input
                    placeholder="Nom ou référence..."
                    value={produitSearch}
                    onChange={(e) => setProduitSearch(e.target.value)}
                  />
                  {produits.length > 0 && (
                    <ul className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {produits.map((p) => (
                        <li
                          key={p.id}
                          className="px-3 py-2 hover:bg-muted cursor-pointer"
                          onMouseDown={() => addProduit(p)}
                        >
                          <p className="text-sm font-semibold">{p.nom}</p>
                          <p className="text-xs text-muted-foreground">{p.reference} - Achat: {parseFloat(p.prix_achat).toFixed(2)} XOF</p>
                          {p.similarity && p.similarity < 0.5 && (
                            <p className="text-xs text-amber-500 italic">Résultat approximatif</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {produitSearch.length >= 2 && produits.length === 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg p-3 text-sm text-muted-foreground">
                      Aucun produit trouvé pour "{produitSearch}". Essayez une orthographe différente.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {lignes.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Réf</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Qté</TableHead>
                    <TableHead>Prix Unitaire</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignes.map((ligne, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm">{ligne.produit_reference}</TableCell>
                      <TableCell className="font-semibold">{ligne.produit_nom}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-20"
                          min="1"
                          value={ligne.quantite}
                          onChange={(e) => updateQuantite(index, parseInt(e.target.value) || 1)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-28"
                          step="0.01"
                          value={ligne.prix_unitaire}
                          onChange={(e) => {
                            const newLignes = [...lignes];
                            newLignes[index].prix_unitaire = parseFloat(e.target.value) || 0;
                            setLignes(newLignes);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-bold">{(ligne.quantite * ligne.prix_unitaire).toFixed(2)} XOF</TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeLigne(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes optionnelles"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm}>Annuler</Button>
              <Button type="submit" disabled={submitting || !selectedFournisseur || lignes.length === 0}>
                {submitting ? 'Création...' : 'Créer la Commande'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Orders Table */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Commande</TableHead>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Livraison prévue</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commandes.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/commandes/${c.id}`)}>
                    <TableCell className="font-mono font-semibold">{c.numero_commande}</TableCell>
                    <TableCell>{c.fournisseur_nom}</TableCell>
                    <TableCell>{new Date(c.date_commande).toLocaleDateString('fr-FR')}</TableCell>
                    <TableCell className="font-bold">{parseFloat(c.sous_total).toFixed(2)} XOF</TableCell>
                    <TableCell>{c.date_livraison_prevue ? new Date(c.date_livraison_prevue).toLocaleDateString('fr-FR') : '-'}</TableCell>
                    <TableCell>{getStatutBadge(c.statut)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.statut === 'en_attente' && (
                          <Button variant="ghost" size="sm" onClick={() => updateStatut(c.id, 'validee')}>
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {c.statut === 'validee' && (
                          <Button variant="ghost" size="sm" onClick={() => updateStatut(c.id, 'expediee')}>
                            <Truck className="h-4 w-4" />
                          </Button>
                        )}
                        {(c.statut === 'en_attente' || c.statut === 'validee' || c.statut === 'expediee') && (
                          <Button variant="ghost" size="sm" onClick={() => updateStatut(c.id, 'livree')}>
                            <Package className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {c.statut !== 'annulee' && (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => updateStatut(c.id, 'annulee')}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {commandes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <ShoppingCart className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">Aucune commande trouvée</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
