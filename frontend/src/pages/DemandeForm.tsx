import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { demandeService, stockLocationService } from '../services/api';
import { useAuth } from '../lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Minus, 
  Trash2, 
  Search, 
  ArrowLeft, 
  Send,
  Save,
  Package,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface StockLocation {
  id: number;
  code: string;
  nom: string;
  location_type: 'depot' | 'magasin';
  est_principal: boolean;
}

interface DepotProduct {
  produit_id: number;
  reference: string;
  produit_nom: string;
  prix_vente: string;
  quantite_disponible: number;
}

interface CartItem {
  produit_id: number;
  reference: string;
  produit_nom: string;
  quantite_demandee: number;
  stock_disponible: number;
  notes?: string;
}

export default function DemandeForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  useAuth();
  const isEdit = !!id;

  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [depotProducts, setDepotProducts] = useState<DepotProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  const [formData, setFormData] = useState({
    magasin_id: '',
    depot_id: '',
    motif: '',
  });
  
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load locations
  useEffect(() => {
    loadLocations();
  }, []);

  // Load depot products when depot selected
  useEffect(() => {
    if (formData.depot_id) {
      loadDepotProducts(parseInt(formData.depot_id));
    }
  }, [formData.depot_id, debouncedSearch]);

  // Load existing demande if editing
  useEffect(() => {
    if (isEdit) {
      loadExistingDemande();
    }
  }, [id]);

  const loadLocations = async () => {
    try {
      const response = await stockLocationService.getAll();
      const allLocations = response.data || response || [];
      setLocations(allLocations);

      // Auto-select defaults based on user role
      const magasins = allLocations.filter((l: StockLocation) => l.location_type === 'magasin');
      const depots = allLocations.filter((l: StockLocation) => l.location_type === 'depot');

      if (!isEdit) {
        if (magasins.length > 0) {
          setFormData((prev) => ({ ...prev, magasin_id: String(magasins[0].id) }));
        }
        if (depots.length > 0) {
          setFormData((prev) => ({ ...prev, depot_id: String(depots[0].id) }));
        }
      }
    } catch {
      toast.error('Erreur lors du chargement des locations');
    }
  };

  const loadDepotProducts = async (depotId: number) => {
    setLoadingProducts(true);
    try {
      const response = await demandeService.getDepotStock(depotId, debouncedSearch);
      setDepotProducts(response.data || response || []);
    } catch {
      // Silent fail
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadExistingDemande = async () => {
    setLoading(true);
    try {
      const response = await demandeService.getById(parseInt(id!, 10));
      const demande = response.data || response;

      setFormData({
        magasin_id: String(demande.magasin_id),
        depot_id: String(demande.depot_id),
        motif: demande.motif || '',
      });

      setCart(demande.lignes.map((l: any) => ({
        produit_id: l.produit_id,
        reference: l.reference,
        produit_nom: l.produit_nom,
        quantite_demandee: l.quantite_demandee,
        stock_disponible: l.quantite_disponible || 0,
        notes: l.notes || '',
      })));
    } catch {
      toast.error('Erreur lors du chargement de la demande');
      navigate('/demandes');
    } finally {
      setLoading(false);
    }
  };

  const addToCart = useCallback((product: DepotProduct) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.produit_id === product.produit_id);
      if (existing) {
        return prev.map((item) =>
          item.produit_id === product.produit_id
            ? { ...item, quantite_demandee: Math.min(item.quantite_demandee + 1, product.quantite_disponible) }
            : item
        );
      }
      return [
        ...prev,
        {
          produit_id: product.produit_id,
          reference: product.reference,
          produit_nom: product.produit_nom,
          quantite_demandee: 1,
          stock_disponible: product.quantite_disponible,
        },
      ];
    });
    setSearchQuery('');
    setDebouncedSearch('');
  }, []);

  const updateCartQuantity = useCallback((produitId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.produit_id === produitId
            ? { ...item, quantite_demandee: Math.max(0, item.quantite_demandee + delta) }
            : item
        )
        .filter((item) => item.quantite_demandee > 0)
    );
  }, []);

  const removeFromCart = useCallback((produitId: number) => {
    setCart((prev) => prev.filter((item) => item.produit_id !== produitId));
  }, []);

  const updateCartNotes = useCallback((produitId: number, notes: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.produit_id === produitId ? { ...item, notes } : item
      )
    );
  }, []);

  const handleSubmit = async (andSend: boolean) => {
    if (!formData.magasin_id || !formData.depot_id) {
      toast.error('Veuillez sélectionner un magasin et un dépôt');
      return;
    }

    if (cart.length === 0) {
      toast.error('Ajoutez au moins un produit au panier');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        magasin_id: parseInt(formData.magasin_id),
        depot_id: parseInt(formData.depot_id),
        motif: formData.motif || undefined,
        lignes: cart.map((item) => ({
          produit_id: item.produit_id,
          quantite_demandee: item.quantite_demandee,
          notes: item.notes,
        })),
      };

      let demandeId: number;

      if (isEdit) {
        await demandeService.update(parseInt(id!), payload);
        demandeId = parseInt(id!);
      } else {
        const response = await demandeService.create(payload);
        demandeId = response.data?.id || response.id;
      }

      if (andSend) {
        await demandeService.send(demandeId);
        toast.success(isEdit ? 'Demande modifiée et envoyée' : 'Demande créée et envoyée au dépôt');
      } else {
        toast.success(isEdit ? 'Demande modifiée (brouillon)' : 'Demande créée (brouillon)');
      }

      navigate('/demandes');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSubmitting(false);
    }
  };

  const cartTotalItems = cart.reduce((sum, item) => sum + item.quantite_demandee, 0);

  const magasins = locations.filter((l) => l.location_type === 'magasin');
  const depots = locations.filter((l) => l.location_type === 'depot');

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/demandes')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Retour
        </Button>
        <h1 className="text-2xl font-bold">
          {isEdit ? 'Modifier la demande' : 'Nouvelle demande de réapprovisionnement'}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Location Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Locations</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="magasin">Magasin destinataire *</Label>
                <select
                  id="magasin"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={formData.magasin_id}
                  onChange={(e) => setFormData({ ...formData, magasin_id: e.target.value })}
                  required
                  disabled={isEdit}
                >
                  <option value="">Sélectionner...</option>
                  {magasins.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom} ({m.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="depot">Dépôt source *</Label>
                <select
                  id="depot"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={formData.depot_id}
                  onChange={(e) => setFormData({ ...formData, depot_id: e.target.value })}
                  required
                  disabled={isEdit}
                >
                  <option value="">Sélectionner...</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Product Selection */}
          {formData.depot_id && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Produits disponibles au dépôt</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    Stock affiché à titre indicatif
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un produit par nom ou référence..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {loadingProducts ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : depotProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Aucun produit trouvé</p>
                  </div>
                ) : (
                  <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium">Produit</th>
                          <th className="px-3 py-2 text-right text-xs font-medium">Stock dépôt</th>
                          <th className="px-3 py-2 text-center text-xs font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {depotProducts.map((product) => {
                          const inCart = cart.find((item) => item.produit_id === product.produit_id);
                          const stockClass = product.quantite_disponible <= 5 
                            ? 'text-destructive' 
                            : product.quantite_disponible <= 20 
                              ? 'text-warning' 
                              : 'text-success';

                          return (
                            <tr key={product.produit_id} className={inCart ? 'bg-primary/5' : ''}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-sm">{product.produit_nom}</div>
                                <div className="text-xs text-muted-foreground">{product.reference}</div>
                              </td>
                              <td className={`px-3 py-2 text-right font-medium ${stockClass}`}>
                                {product.quantite_disponible}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {inCart ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => updateCartQuantity(product.produit_id, -1)}
                                    >
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <span className="w-8 text-center text-sm font-medium">{inCart.quantite_demandee}</span>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => updateCartQuantity(product.produit_id, 1)}
                                      disabled={inCart.quantite_demandee >= product.quantite_disponible}
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7"
                                    onClick={() => addToCart(product)}
                                    disabled={product.quantite_disponible === 0}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Ajouter
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="bg-muted/50 p-3 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Le stock affiché est indicatif. Les quantités réellement disponibles 
                    seront vérifiées lors de l&apos;exécution du transfert par le dépôt.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Motif */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Notes éventuelles pour le dépôt..."
                value={formData.motif}
                onChange={(e) => setFormData({ ...formData, motif: e.target.value })}
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Cart */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Panier ({cart.length} articles, {cartTotalItems} unités)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Votre panier est vide</p>
                  <p className="text-xs mt-1">Ajoutez des produits depuis la liste</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.produit_id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.produit_nom}</p>
                          <p className="text-xs text-muted-foreground">{item.reference}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive shrink-0"
                          onClick={() => removeFromCart(item.produit_id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateCartQuantity(item.produit_id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={item.stock_disponible}
                          value={item.quantite_demandee}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            if (val <= 0) {
                              removeFromCart(item.produit_id);
                            } else {
                              setCart((prev) =>
                                prev.map((i) =>
                                  i.produit_id === item.produit_id
                                    ? { ...i, quantite_demandee: Math.min(val, i.stock_disponible) }
                                    : i
                                )
                              );
                            }
                          }}
                          className="w-16 h-6 text-center text-sm px-1"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => updateCartQuantity(item.produit_id, 1)}
                          disabled={item.quantite_demandee >= item.stock_disponible}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input
                        placeholder="Notes (optionnel)"
                        value={item.notes || ''}
                        onChange={(e) => updateCartNotes(item.produit_id, e.target.value)}
                        className="mt-2 h-7 text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}

              {cart.length > 0 && (
                <>
                  <div className="border-t pt-4 space-y-2">
                    <Button
                      className="w-full gap-2"
                      onClick={() => handleSubmit(false)}
                      disabled={submitting}
                      variant="outline"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isEdit ? 'Enregistrer' : 'Enregistrer brouillon'}
                    </Button>
                    <Button
                      className="w-full gap-2"
                      onClick={() => handleSubmit(true)}
                      disabled={submitting}
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isEdit ? 'Enregistrer et envoyer' : 'Envoyer au dépôt'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
