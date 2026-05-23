import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devisService, stockLocationService, ventesService } from '@/services/api';
import { TiersPicker } from '@/components/TiersPicker';
import { Tiers, Produit } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Check, FileText, Search, ShoppingCart, X } from 'lucide-react';
import { formatFCFA as formatXOF } from '@/utils/format';
import { toast } from 'sonner';

interface LigneDevis {
  produit_id: number;
  produit_nom: string;
  produit_reference: string;
  quantite: number;
  prix_unitaire: number;
  prix_revient: number;
  stock_dispo: number;
}

interface StockLocation {
  id: number;
  code: string;
  nom: string;
  est_principal: boolean;
}

interface StockLevel {
  produit_id: number;
  quantite_disponible: number;
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
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [locationStockMap, setLocationStockMap] = useState<Record<number, number>>({});

  useEffect(() => {
    const loadMagasins = async () => {
      try {
        const response = await ventesService.getLocations();
        const magasins: StockLocation[] = response.data || response;
        setLocations(magasins);
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
    if (!selectedLocationId) return;
    const loadLocationStock = async () => {
      try {
        const response = await stockLocationService.getStockLevels(selectedLocationId);
        const levels: StockLevel[] = response.data || response;
        const nextMap: Record<number, number> = {};
        for (const level of levels) {
          nextMap[level.produit_id] = Number(level.quantite_disponible || 0);
        }
        setLocationStockMap(nextMap);
      } catch {
        toast.error('Impossible de charger le stock du magasin');
      }
    };
    void loadLocationStock();
  }, [selectedLocationId]);

  useEffect(() => {
    if (!selectedLocationId) return;
    setLignes((prev) =>
      prev.map((ligne) => ({
        ...ligne,
        stock_dispo: locationStockMap[ligne.produit_id] ?? ligne.stock_dispo,
      })),
    );
  }, [locationStockMap, selectedLocationId]);

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

    const prixVente = parseFloat(produit.prix_vente as any) || 0;
    const prixAchat = parseFloat(produit.prix_achat as any) || 0;
    const fallbackStock =
      typeof produit.stock === 'string' ? parseInt(produit.stock, 10) : Number(produit.stock || 0);
    const stock = selectedLocationId
      ? locationStockMap[produit.id] ?? fallbackStock
      : fallbackStock;

    setLignes((prev) => [
      ...prev,
      {
        produit_id: produit.id,
        produit_nom: produit.nom,
        produit_reference: produit.reference,
        quantite: 1,
        prix_unitaire: prixVente,
        prix_revient: prixAchat,
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
              <ShoppingCart className="h-5 w-5" />
              Produits
            </CardTitle>
            <CardDescription>Ajoutez les produits au devis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {locations.length > 1 && (
              <div className="max-w-xs">
                <label className="text-xs text-muted-foreground block mb-1.5">Magasin (stock)</label>
                <select
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={selectedLocationId || ''}
                  onChange={(e) => setSelectedLocationId(parseInt(e.target.value, 10))}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nom} ({l.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full pl-10 pr-3 py-2.5 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Rechercher un produit par nom ou référence…"
                value={produitSearch}
                onChange={(e) => {
                  setProduitSearch(e.target.value);
                  setShowProduitDropdown(true);
                }}
                onFocus={() => setShowProduitDropdown(true)}
                onBlur={() => setTimeout(() => setShowProduitDropdown(false), 150)}
              />
              {showProduitDropdown && produitSearch.length >= 2 && produits.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-popover border rounded-lg shadow-lg px-3 py-3 text-sm text-muted-foreground">
                  <p>Aucun produit trouvé pour "{produitSearch}"</p>
                  <p className="text-xs mt-1">Essayez une orthographe différente ou vérifiez le stock en magasin</p>
                </div>
              )}
              {showProduitDropdown && produits.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-popover border rounded-lg shadow-lg overflow-hidden max-h-80 overflow-y-auto">
                  {produits.map((p) => {
                    const prixVente = parseFloat(p.prix_vente as any) || 0;
                    const apiStock =
                      typeof p.stock === 'string' ? parseInt(p.stock, 10) : Number(p.stock || 0);
                    const stock = selectedLocationId
                      ? locationStockMap[p.id] ?? apiStock
                      : apiStock;
                    const stockMin =
                      typeof p.stock_min === 'string'
                        ? parseInt(p.stock_min, 10)
                        : Number(p.stock_min || 0);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => addProduit(p)}
                        className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-muted border-b last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{p.nom}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {p.reference} · stock: {stock}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold font-mono">{formatXOF(prixVente)}</div>
                          <div
                            className={`text-[11px] ${
                              stock <= stockMin ? 'text-destructive' : 'text-emerald-600'
                            }`}
                          >
                            {stock <= stockMin ? 'Stock bas' : 'Disponible'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {lignes.length > 0 ? (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead className="bg-muted/50">
                      <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-semibold px-3 py-2.5">Produit</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[150px]">Prix unitaire</th>
                        <th className="text-center font-semibold px-3 py-2.5 w-[90px]">Qté</th>
                        <th className="text-center font-semibold px-3 py-2.5 w-[80px]">Stock</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[110px]">Marge</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[120px]">Total</th>
                        <th className="w-8 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((ligne, index) => {
                        const lineTotal = ligne.quantite * ligne.prix_unitaire;
                        const marginPct =
                          ligne.prix_unitaire > 0
                            ? ((ligne.prix_unitaire - ligne.prix_revient) / ligne.prix_unitaire) * 100
                            : 0;
                        const marginAbs = (ligne.prix_unitaire - ligne.prix_revient) * ligne.quantite;
                        const belowCost = ligne.prix_revient > 0 && ligne.prix_unitaire < ligne.prix_revient;
                        const overstock = ligne.quantite > ligne.stock_dispo;
                        return (
                          <tr key={`${ligne.produit_id}-${index}`} className="border-t align-middle">
                            <td className="px-3 py-3">
                              <div className="font-medium">{ligne.produit_nom}</div>
                              <div className="text-xs font-mono text-muted-foreground">
                                {ligne.produit_reference}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={ligne.prix_unitaire === 0 ? '' : ligne.prix_unitaire}
                                onChange={(e) => {
                                  const n = parseFloat(e.target.value);
                                  updatePrix(index, Number.isNaN(n) ? 0 : n);
                                }}
                                className="w-28 px-2 py-1 text-right text-sm border rounded font-mono bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                              <div className="text-[10px] text-muted-foreground mt-1 flex justify-end items-baseline gap-1">
                                <span className="uppercase tracking-wider">P. revient</span>
                                <span className="font-mono">{formatXOF(ligne.prix_revient)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="number"
                                min="1"
                                value={ligne.quantite === 0 ? '' : ligne.quantite}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10);
                                  updateQuantite(index, Number.isNaN(n) ? 0 : n);
                                }}
                                onBlur={(e) => {
                                  if (!e.target.value || parseInt(e.target.value, 10) < 1) {
                                    updateQuantite(index, 1);
                                  }
                                }}
                                className="w-16 px-2 py-1 text-center text-sm border rounded font-mono bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </td>
                            <td className={`px-3 py-3 text-center font-mono ${overstock ? 'text-destructive' : ''}`}>
                              {ligne.stock_dispo}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div
                                className={`inline-flex flex-col items-end px-2 py-1 rounded font-mono text-xs font-semibold leading-tight ${
                                  belowCost
                                    ? 'bg-destructive/10 text-destructive'
                                    : 'bg-emerald-500/10 text-emerald-700'
                                }`}
                              >
                                <span>
                                  {marginPct >= 0 ? '+' : ''}
                                  {marginPct.toFixed(1)}%
                                </span>
                                <span className="text-[10px] font-medium opacity-80">
                                  {marginAbs >= 0 ? '+' : '−'}
                                  {formatXOF(Math.abs(marginAbs))}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold">
                              {formatXOF(lineTotal)}
                            </td>
                            <td className="px-2 py-3 text-center">
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive p-1"
                                onClick={() => removeLigne(index)}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="mt-4 py-8 text-center text-sm text-muted-foreground bg-muted/30 rounded-lg">
                Aucun produit. Recherchez pour ajouter.
              </div>
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
              <p className="text-2xl font-bold">{formatXOF(total)}</p>
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