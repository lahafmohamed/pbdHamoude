import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bonLivraisonService, produitService } from '@/services/api';
import { TiersPicker } from '@/components/TiersPicker';
import { Tiers, Produit } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Check, Search, Truck, Users, X } from 'lucide-react';
import { toast } from 'sonner';

interface LigneBonLivraison {
  produit_id: number;
  produit_nom: string;
  produit_reference: string;
  quantite_commandee: number;
  quantite_livree: number;
  prix_unitaire: number;
  stock_dispo: number;
}

export default function NouveauBonLivraison() {
  const navigate = useNavigate();

  const [selectedClient, setSelectedClient] = useState<Tiers | null>(null);

  const [produits, setProduits] = useState<Produit[]>([]);
  const [produitSearch, setProduitSearch] = useState('');
  const [showProduitDropdown, setShowProduitDropdown] = useState(false);

  const [lignes, setLignes] = useState<LigneBonLivraison[]>([]);
  const [notes, setNotes] = useState('');
  const [devisId, setDevisId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (produitSearch.length >= 2) {
      produitService.searchFuzzy(produitSearch, 10, 0.1).then(setProduits).catch(() => setProduits([]));
    } else {
      setProduits([]);
    }
  }, [produitSearch]);

  const addProduit = (produit: Produit) => {
    if (lignes.some((l) => l.produit_id === produit.id)) {
      toast.warning('Ce produit est deja dans le bon de livraison');
      return;
    }

    const stock = typeof produit.stock === 'string' ? parseInt(produit.stock) : produit.stock;
    const prixVente = parseFloat(produit.prix_vente as any) || 0;

    setLignes((prev) => [
      ...prev,
      {
        produit_id: produit.id,
        produit_nom: produit.nom,
        produit_reference: produit.reference,
        quantite_commandee: 1,
        quantite_livree: 1,
        prix_unitaire: prixVente,
        stock_dispo: stock,
      },
    ]);

    setProduitSearch('');
    setProduits([]);
    setShowProduitDropdown(false);
  };

  const updateLigne = (index: number, field: keyof LigneBonLivraison, value: number) => {
    setLignes((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeLigne = (index: number) => {
    setLignes((prev) => prev.filter((_, i) => i !== index));
  };

  const total = lignes.reduce((sum, l) => sum + l.quantite_livree * l.prix_unitaire * 1.19, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClient) {
      toast.error('Veuillez selectionner un client');
      return;
    }

    const devisIdNumber = Number(devisId);
    if (!devisIdNumber || devisIdNumber <= 0) {
      toast.error('Le numero de devis est obligatoire');
      return;
    }

    if (lignes.length === 0) {
      toast.error('Veuillez ajouter au moins un produit');
      return;
    }

    for (const ligne of lignes) {
      if (ligne.quantite_commandee <= 0 || ligne.quantite_livree <= 0) {
        toast.error(`Quantite invalide pour "${ligne.produit_nom}"`);
        return;
      }
      if (ligne.prix_unitaire < 0) {
        toast.error(`Prix invalide pour "${ligne.produit_nom}"`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await bonLivraisonService.create({
        tiers_id: selectedClient!.id,
        devis_id: devisIdNumber,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id,
          quantite_commandee: l.quantite_commandee,
          quantite_livree: l.quantite_livree,
          prix_unitaire: l.prix_unitaire,
        })),
        notes: notes || undefined,
      });

      toast.success(`Bon de livraison ${result.numero_bl || ''} cree avec succes`.trim());
      navigate('/bons-livraison');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la creation du bon de livraison');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 w-full space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-8 w-8" />
            Nouveau Bon de Livraison
          </h1>
          <p className="text-muted-foreground mt-1">Creez un nouveau bon de livraison client</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Devis parent</CardTitle>
            <CardDescription>Le bon de livraison doit être lié à un devis confirmé</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              min={1}
              placeholder="ID du devis"
              value={devisId}
              onChange={(e) => setDevisId(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client</CardTitle>
            <CardDescription>Selectionnez le client</CardDescription>
          </CardHeader>
          <CardContent>
            <TiersPicker role="client" value={selectedClient} onChange={setSelectedClient} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Produits
            </CardTitle>
            <CardDescription>Ajoutez les produits a livrer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Rechercher un produit..."
                value={produitSearch}
                onChange={(e) => {
                  setProduitSearch(e.target.value);
                  setShowProduitDropdown(true);
                }}
                onFocus={() => setShowProduitDropdown(true)}
                onBlur={() => setTimeout(() => setShowProduitDropdown(false), 200)}
              />
              {showProduitDropdown && produits.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {produits.map((p) => (
                    <li
                      key={p.id}
                      className="px-4 py-3 hover:bg-muted cursor-pointer transition-colors flex justify-between border-b last:border-b-0"
                      onMouseDown={() => addProduit(p)}
                    >
                      <div>
                        <p className="font-semibold">{p.nom}</p>
                        <p className="text-sm text-muted-foreground font-mono">{p.reference}</p>
                      </div>
                      <p className="font-semibold">{parseFloat(p.prix_vente as any || 0).toFixed(2)} XOF</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="w-28">Qte Commandee</TableHead>
                    <TableHead className="w-28">Qte Livree</TableHead>
                    <TableHead className="w-36">Prix Unitaire</TableHead>
                    <TableHead className="w-32">Total TTC</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Aucun produit ajoute
                      </TableCell>
                    </TableRow>
                  ) : (
                    lignes.map((ligne, index) => (
                      <TableRow key={ligne.produit_id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{ligne.produit_nom}</p>
                            <p className="text-xs text-muted-foreground font-mono">{ligne.produit_reference}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={ligne.quantite_commandee}
                            onChange={(e) => updateLigne(index, 'quantite_commandee', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={ligne.quantite_livree}
                            onChange={(e) => updateLigne(index, 'quantite_livree', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={ligne.prix_unitaire}
                            onChange={(e) => updateLigne(index, 'prix_unitaire', Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell className="font-semibold">
                          {(ligne.quantite_livree * ligne.prix_unitaire * 1.19).toFixed(2)} XOF
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeLigne(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations complementaires</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Notes internes ou instructions de livraison..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total estime (TTC)</p>
              <p className="text-2xl font-bold">{total.toFixed(2)} XOF</p>
            </div>
            <Button type="submit" disabled={submitting || !selectedClient || lignes.length === 0}>
              <Check className="h-4 w-4 mr-2" />
              {submitting ? 'Creation...' : 'Creer le bon de livraison'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
