import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { factureService, stockLocationService, ventesService } from '../services/api';
import { TiersPicker } from '../components/TiersPicker';
import { Produit, Tiers } from '../types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Search, Minus, Plus, X, AlertCircle, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

interface LigneFacture {
  produit_id: number;
  produit_nom: string;
  produit_reference: string;
  quantite: number;
  prix_unitaire: number;
  prix_unitaire_default: number;
  prix_revient: number;
  remise_pct: number;
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

import { formatFCFA as formatXOF } from '../utils/format';

const TVA_RATE = 0.19;

export default function NouvelleFacture() {
  const navigate = useNavigate();

  const [selectedClient, setSelectedClient] = useState<Tiers | null>(null);

  const [produits, setProduits] = useState<Produit[]>([]);
  const [produitSearch, setProduitSearch] = useState('');
  const [showProduitDropdown, setShowProduitDropdown] = useState(false);

  const [lignes, setLignes] = useState<LigneFacture[]>([]);
  const [notes, setNotes] = useState('');
  const [echeance, setEcheance] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [locationStockMap, setLocationStockMap] = useState<Record<number, number>>({});

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const response = await ventesService.getLocations();
        const magasinLocations: StockLocation[] = response.data || response;
        setLocations(magasinLocations);
        const defaultLocation = magasinLocations.find((l) => l.est_principal) || magasinLocations[0];
        if (defaultLocation) {
          setSelectedLocationId(defaultLocation.id);
        } else {
          toast.error('Aucun magasin actif disponible pour la facturation');
        }
      } catch {
        toast.error('Impossible de charger les magasins');
      }
    };
    void loadLocations();
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
        toast.error('Impossible de charger le stock de la location');
      }
    };
    void loadLocationStock();
  }, [selectedLocationId]);

  useEffect(() => {
    if (!selectedLocationId) return;
    setLignes((prev) =>
      prev.map((ligne) => ({
        ...ligne,
        stock_dispo: locationStockMap[ligne.produit_id] ?? 0,
      })),
    );
  }, [locationStockMap, selectedLocationId]);

  useEffect(() => {
    if (produitSearch.length < 2) {
      setProduits([]);
      return;
    }
    ventesService
      .searchFuzzy(produitSearch, 20, selectedLocationId || undefined)
      .then((data) => {
        setProduits(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
  }, [produitSearch, selectedLocationId]);

  const addProduit = (p: Produit) => {
    const existing = lignes.find((l) => l.produit_id === p.id);
    if (existing) {
      setLignes(lignes.map((l) => (l.produit_id === p.id ? { ...l, quantite: l.quantite + 1 } : l)));
      setProduitSearch('');
      setShowProduitDropdown(false);
      return;
    }
    const prixVente = parseFloat(p.prix_vente as any) || 0;
    const prixAchat = parseFloat(p.prix_achat as any) || 0;
    const fallbackStock =
      typeof p.stock === 'string' ? parseInt(p.stock, 10) : Number(p.stock || 0);
    const stock = selectedLocationId
      ? locationStockMap[p.id] ?? fallbackStock
      : fallbackStock;

    setLignes([
      ...lignes,
      {
        produit_id: p.id,
        produit_nom: p.nom,
        produit_reference: p.reference,
        quantite: 1,
        prix_unitaire: prixVente,
        prix_unitaire_default: prixVente,
        prix_revient: prixAchat,
        remise_pct: 0,
        stock_dispo: stock,
      },
    ]);
    setProduitSearch('');
    setShowProduitDropdown(false);
  };

  const updateLigne = (idx: number, patch: Partial<LigneFacture>) => {
    setLignes((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLigne = (idx: number) => setLignes(lignes.filter((_, i) => i !== idx));

  const totals = useMemo(() => {
    const subtotal = lignes.reduce(
      (s, l) => s + l.quantite * l.prix_unitaire * (1 - l.remise_pct / 100),
      0,
    );
    const totalCost = lignes.reduce((s, l) => s + l.quantite * l.prix_revient, 0);
    const margin = subtotal - totalCost;
    const marginPct = subtotal > 0 ? (margin / subtotal) * 100 : 0;
    const tva = subtotal * TVA_RATE;
    const total = subtotal + tva;
    const totalUnits = lignes.reduce((s, l) => s + l.quantite, 0);
    return { subtotal, totalCost, margin, marginPct, tva, total, totalUnits };
  }, [lignes]);

  const isValid = !!selectedClient && lignes.length > 0;
  const disabledReason = !selectedClient ? 'Sélectionnez un tiers (client)' : lignes.length === 0 ? 'Ajoutez au moins un produit' : null;

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
      if (ligne.quantite > ligne.stock_dispo) {
        toast.error(`Stock insuffisant pour "${ligne.produit_nom}" (disponible: ${ligne.stock_dispo})`);
        return;
      }
      if (ligne.quantite <= 0) {
        toast.error(`Quantité invalide pour "${ligne.produit_nom}"`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const result = await factureService.create({
        tiers_id: selectedClient.id,
        location_id: selectedLocationId || undefined,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id,
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire * (1 - l.remise_pct / 100),
        })),
        notes: notes || undefined,
      });
      toast.success(`Facture ${result.numero_facture} créée avec succès!`);
      navigate('/factures');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erreur lors de la création de la facture');
    } finally {
      setSubmitting(false);
    }
  };

  const sectionLabel =
    'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';
  const cardCls = 'rounded-xl border bg-card p-5 shadow-sm';

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full p-4 sm:p-8 tabular-nums"
      style={{ fontFeatureSettings: '"tnum"' }}
    >
      {/* Page header */}
      <div className="flex items-center gap-4 mb-6">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Nouvelle Facture</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Brouillon · <span className="font-mono">FAC-{new Date().getFullYear()}-XXXX</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        {/* Left column */}
        <div className="grid gap-4 min-w-0">
          {/* Client + meta */}
          <section className={cardCls}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className={sectionLabel}>Client (Tiers)</h2>
            </div>
            <TiersPicker role="client" value={selectedClient} onChange={setSelectedClient} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">
                  Location de vente
                </label>
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
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Échéance</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  value={echeance}
                  onChange={(e) => setEcheance(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Products */}
          <section className={cardCls}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className={sectionLabel}>
                Produits{' '}
                <span className="text-muted-foreground/60 font-medium normal-case tracking-normal">
                  · {lignes.length}
                </span>
              </h2>
              <button
                type="button"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <ScanLine className="h-3.5 w-3.5" /> Scanner code-barres
              </button>
            </div>

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
                            {(p as any).similarity && (p as any).similarity < 0.5 && (
                              <span className="text-amber-500 ml-1">(résultat approximatif)</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold font-mono">
                            {formatXOF(prixVente)}
                          </div>
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
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-semibold px-3 py-2.5">Produit</th>
                        <th className="text-center font-semibold px-3 py-2.5 w-[110px]">Qté</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[150px]">
                          Prix unitaire
                        </th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[110px]">Marge</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[80px]">Remise</th>
                        <th className="text-right font-semibold px-3 py-2.5 w-[120px]">Total</th>
                        <th className="w-8 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l, i) => {
                        const effPrice = l.prix_unitaire * (1 - l.remise_pct / 100);
                        const lineTotal = l.quantite * effPrice;
                        const lineCost = l.quantite * l.prix_revient;
                        const marginAbs = lineTotal - lineCost;
                        const marginPct =
                          effPrice > 0 ? ((effPrice - l.prix_revient) / effPrice) * 100 : 0;
                        const belowCost = l.prix_revient > 0 && effPrice < l.prix_revient;
                        const overstock = l.quantite > l.stock_dispo;
                        const priceOverridden = l.prix_unitaire !== l.prix_unitaire_default;
                        return (
                          <tr key={`${l.produit_id}-${i}`} className="border-t align-middle">
                            <td className="px-3 py-3">
                              <div className="font-medium">{l.produit_nom}</div>
                              <div className="text-xs font-mono text-muted-foreground">
                                {l.produit_reference}
                              </div>
                              {overstock && (
                                <div className="inline-flex items-center gap-1 mt-1 text-[11px] text-destructive">
                                  <AlertCircle className="h-3 w-3" />
                                  Stock insuffisant ({l.stock_dispo} dispo)
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <div className="inline-flex items-center border rounded-md overflow-hidden">
                                <button
                                  type="button"
                                  className="px-2 py-1 text-muted-foreground hover:bg-muted"
                                  onClick={() =>
                                    updateLigne(i, { quantite: Math.max(1, l.quantite - 1) })
                                  }
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <input
                                  className="w-10 text-center text-sm border-x py-1 font-mono bg-background focus:outline-none"
                                  value={l.quantite}
                                  onChange={(e) =>
                                    updateLigne(i, {
                                      quantite: Math.max(1, parseInt(e.target.value, 10) || 1),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="px-2 py-1 text-muted-foreground hover:bg-muted"
                                  onClick={() => updateLigne(i, { quantite: l.quantite + 1 })}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={l.prix_unitaire}
                                onChange={(e) =>
                                  updateLigne(i, {
                                    prix_unitaire: Math.max(0, parseFloat(e.target.value) || 0),
                                  })
                                }
                                className={`w-28 px-2 py-1 text-right text-sm border rounded font-mono focus:outline-none focus:ring-1 focus:ring-ring ${
                                  priceOverridden ? 'bg-primary/10 border-primary/30' : 'bg-background'
                                }`}
                              />
                              <div className="text-[10px] text-muted-foreground mt-1 flex justify-end items-baseline gap-1">
                                <span className="uppercase tracking-wider">P. revient</span>
                                <span className="font-mono">{formatXOF(l.prix_revient)}</span>
                              </div>
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
                            <td className="px-3 py-3 text-right">
                              <div className="inline-flex items-baseline gap-0.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={l.remise_pct}
                                  onChange={(e) =>
                                    updateLigne(i, {
                                      remise_pct: Math.min(
                                        100,
                                        Math.max(0, parseFloat(e.target.value) || 0),
                                      ),
                                    })
                                  }
                                  className="w-12 px-1.5 py-1 text-right text-sm border rounded font-mono bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold">
                              {formatXOF(lineTotal)}
                            </td>
                            <td className="px-2 py-3 text-center">
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive p-1"
                                onClick={() => removeLigne(i)}
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
                Aucun produit. Recherchez ou scannez pour ajouter.
              </div>
            )}
          </section>
        </div>

        {/* Right column */}
        <aside className="grid gap-4 lg:sticky lg:top-4">
          {/* Summary card */}
          <section className="rounded-md border bg-card p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Résumé
            </h2>

            <SummaryRow label="Sous-total" value={formatXOF(totals.subtotal)} />
            <SummaryRow
              label={`TVA (${(TVA_RATE * 100).toFixed(0)}%)`}
              value={formatXOF(totals.tva)}
            />
            <div className="h-px bg-border my-3" />
            <SummaryRow label="Total TTC" value={formatXOF(totals.total)} large />

            <div
              className={`mt-4 p-3 rounded-md border ${
                totals.margin >= 0
                  ? 'bg-success-50 border-success-200'
                  : 'bg-danger-50 border-danger-200'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Marge brute
                </span>
                <span
                  className={`tabular-nums text-sm font-semibold ${
                    totals.margin >= 0 ? 'text-success-700' : 'text-danger-700'
                  }`}
                >
                  {totals.margin >= 0 ? '+' : '−'}
                  {formatXOF(Math.abs(totals.margin))}
                </span>
              </div>
              <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                <span className="tabular-nums">P. revient {formatXOF(totals.totalCost)}</span>
                <span className="tabular-nums">
                  {totals.marginPct >= 0 ? '+' : ''}
                  {totals.marginPct.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="mt-3 px-3 py-2 rounded-md bg-muted text-xs text-muted-foreground">
              {lignes.length} ligne{lignes.length > 1 ? 's' : ''} · {totals.totalUnits} unité
              {totals.totalUnits > 1 ? 's' : ''}
            </div>
          </section>

          {/* Notes */}
          <section className={cardCls}>
            <label className="text-sm font-semibold block mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Notes optionnelles visibles sur la facture…"
              className="w-full px-3 py-2 text-sm rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </section>

          <Button
            type="submit"
            disabled={!isValid || submitting}
            className="w-full h-12 text-base font-semibold"
          >
            {submitting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                Création en cours…
              </>
            ) : (
              <>Créer la facture · {formatXOF(totals.total)}</>
            )}
          </Button>
          {disabledReason && !submitting && (
            <div className="text-xs text-muted-foreground text-center -mt-2">{disabledReason}</div>
          )}
        </aside>
      </div>
    </form>
  );
}

function SummaryRow({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div
      className={`flex justify-between items-baseline ${
        large ? 'py-1 text-base font-semibold text-foreground' : 'py-1 text-sm text-muted-foreground'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
