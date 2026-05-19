import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devisService, ventesService } from '@/services/api';
import { TiersPicker } from '@/components/TiersPicker';
import { Tiers, Produit } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Check, FileText, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';

interface LigneDevis {
  produit_id: number;
  produit_nom: string;
  produit_reference: string;
  quantite: number;
  prix_unitaire: number;
  stock_dispo: number;
}

interface StockLocation {
  id: number;
  code: string;
  nom: string;
  est_principal: boolean;
}

export default function NouveauDevis() {
  const navigate = useNavigate();
  const [selectedClient, setSelectedClient] = useState<Tiers | null>(null);

  const [produits, setProduits] = useState<Produit[]>([]);
  const [produitSearch, setProduitSearch] = useState('');
  const [showProduitDropdown, setShowProduitDropdown] = useState(false);

  const [lignes, setLignes] = useState<LigneDevis[]>([]);
  const [dateValidite, setDateValidite] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);

  useEffect(() => {
    const loadMagasins = async () => {
      try {
        const response = await ventesService.getLocations();
        const magasins: StockLocation[] = response.data || response;
        const defaultMagasin = magasins.find((m) => m.est_principal) || magasins[0];
        if (defaultMagasin) {
          setSelectedLocationId(defaultMagasin.id);
        } else {
          toast.error('Aucun magasin actif disponible pour les devis');
        }
      } catch {
        toast.error('Impossible de charger les magasins');
      }
    };

    void loadMagasins();
  }, []);

  useEffect(() => {
    if (produitSearch.length >= 2) {
      ventesService
        .searchFuzzy(produitSearch, 20, selectedLocationId || undefined)
        .then((data) => {
          setProduits(Array.isArray(data) ? data : []);
        })
        .catch(() => setProduits([]));
    } else {
      setProduits([]);
    }
  }, [produitSearch, selectedLocationId]);

  const addProduit = (produit: Produit) => {
    if (lignes.some((l) => l.produit_id === produit.id)) {
      toast.warning('Ce produit est déjà dans le devis');
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
        quantite: 1,
        prix_unitaire: prixVente,
        stock_dispo: stock,
      },
    ]);
    setProduitSearch('');
    setProduits([]);
    setShowProduitDropdown(false);
  };

  const updateQuantite = (index: number, quantite: number) => {
    setLignes((prev) => {
      const copy = [...prev];
      copy[index].quantite = quantite;
      return copy;
    });
  };

  const updatePrix = (index: number, prix: number) => {
    setLignes((prev) => {
      const copy = [...prev];
      copy[index].prix_unitaire = prix;
      return copy;
    });
  };

  const removeLigne = (index: number) => {
    setLignes((prev) => prev.filter((_, i) => i !== index));
  };

  const total = lignes.reduce((sum, l) => sum + l.quantite * l.prix_unitaire, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClient) {
      toast.error('Veuillez sélectionner un client');
      return;
    }

    if (lignes.length === 0) {
      toast.error('Veuillez ajouter au moins un produit');
      return;
    }

    for (const ligne of lignes) {
      if (ligne.quantite <= 0) {
        toast.error(`Quantité invalide pour "${ligne.produit_nom}"`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await devisService.create({
        tiers_id: selectedClient!.id,
        location_id: selectedLocationId || undefined,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id,
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire,
        })),
        valid_until: dateValidite || undefined,
        notes: notes || undefined,
      });

      toast.success('Devis créé avec succès');
      navigate('/devis');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la création du devis');
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
            <FileText className="h-8 w-8" />
            Nouveau Devis
          </h1>
          <p className="text-muted-foreground mt-1">Créez un nouveau devis client</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Client</CardTitle>
            <CardDescription>Sélectionnez le client</CardDescription>
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
            <CardDescription>Ajoutez les produits au devis</CardDescription>
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
              {showProduitDropdown && produitSearch.length >= 2 && produits.length === 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground">
                  <p>Aucun produit trouvé pour "{produitSearch}"</p>
                  <p className="text-xs mt-1">Essayez une orthographe différente ou vérifiez le stock</p>
                </div>
              )}
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

            {lignes.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Réf</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Prix</TableHead>
                    <TableHead>Qté</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lignes.map((ligne, index) => (
                    <TableRow key={`${ligne.produit_id}-${index}`}>
                      <TableCell className="font-mono text-sm">{ligne.produit_reference}</TableCell>
                      <TableCell>{ligne.produit_nom}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-28"
                          min="0"
                          step="0.01"
                          value={ligne.prix_unitaire}
                          onChange={(e) => updatePrix(index, parseFloat(e.target.value) || 0)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-20"
                          min="1"
                          value={ligne.quantite}
                          onChange={(e) => updateQuantite(index, parseInt(e.target.value) || 1)}
                        />
                      </TableCell>
                      <TableCell>{ligne.stock_dispo}</TableCell>
                      <TableCell>{(ligne.quantite * ligne.prix_unitaire).toFixed(2)} XOF</TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeLigne(index)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations complémentaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Date de validité</label>
              <Input
                type="date"
                value={dateValidite}
                onChange={(e) => setDateValidite(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                placeholder="Ajoutez une note..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Montant total estimé</p>
              <p className="text-2xl font-bold">{total.toFixed(2)} XOF</p>
            </div>
            <Button type="submit" disabled={submitting || !selectedClient || lignes.length === 0}>
              <Check className="h-4 w-4 mr-2" />
              {submitting ? 'Création...' : 'Créer le devis'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}