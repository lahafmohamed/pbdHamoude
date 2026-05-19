import { useState, useEffect } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { stockLocationService } from '../services/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { fuzzyScore } from '../utils/format';

interface StockLocation {
  id: number;
  code: string;
  nom: string;
  adresse: string | null;
  responsable_id: number | null;
  responsable_username: string | null;
  actif: boolean;
  est_principal: boolean;
  created_at: string;
}

interface StockLevel {
  id: number;
  produit_id: number;
  quantite: number;
  quantite_reservee: number;
  produit_nom: string;
  reference: string;
  prix_vente: string;
  quantite_disponible: number;
}

export default function StockLocations() {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<StockLocation | null>(null);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    code: '',
    nom: '',
    adresse: '',
    est_principal: false,
  });

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const data = await stockLocationService.getAll();
      setLocations(data.data || data);
    } catch {
      toast.error('Erreur chargement locations');
    } finally {
      setLoading(false);
    }
  };

  const fetchStockLevels = async (locationId: number) => {
    try {
      const data = await stockLocationService.getStockLevels(locationId);
      setStockLevels(data.data || data);
    } catch {
      toast.error('Erreur chargement stock');
    }
  };

  const handleSelectLocation = async (location: StockLocation) => {
    setSelectedLocation(location);
    setSearchQuery('');
    await fetchStockLevels(location.id);
  };

  const filteredStockLevels = searchQuery.trim()
    ? stockLevels
        .map((level) => {
          const nomScore = fuzzyScore(searchQuery, level.produit_nom);
          const refScore = fuzzyScore(searchQuery, level.reference);
          return { level, score: Math.max(nomScore, refScore) };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((row) => row.level)
    : stockLevels;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await stockLocationService.create(formData);
      toast.success('Location créée');
      setShowCreateForm(false);
      setFormData({ code: '', nom: '', adresse: '', est_principal: false });
      fetchLocations();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur création location');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Locations de stock</h1>
        <Button onClick={() => setShowCreateForm(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nouvelle location
        </Button>
      </div>

      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouvelle location</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="loc-code">Code *</Label>
              <Input id="loc-code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-nom">Nom *</Label>
              <Input id="loc-nom" value={formData.nom} onChange={(e) => setFormData({ ...formData, nom: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-adresse">Adresse</Label>
              <Textarea id="loc-adresse" value={formData.adresse} onChange={(e) => setFormData({ ...formData, adresse: e.target.value })} />
            </div>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm font-medium">Location principale</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                checked={formData.est_principal}
                onChange={(e) => setFormData({ ...formData, est_principal: e.target.checked })}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreateForm(false)}>Annuler</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Création…
                  </>
                ) : 'Créer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Locations</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Nom</th>
                    <th className="px-3 py-2 font-medium">Principal</th>
                    <th className="px-3 py-2 font-medium">Statut</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {locations.map((location) => (
                    <tr key={location.id} className={`hover:bg-muted/30 ${selectedLocation?.id === location.id ? 'bg-primary/10' : ''}`}>
                      <td className="px-3 py-2 font-medium num">{location.code}</td>
                      <td className="px-3 py-2">{location.nom}</td>
                      <td className="px-3 py-2">
                        {location.est_principal && <Check className="h-4 w-4 text-primary" aria-label="Principal" />}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          location.actif ? 'bg-success-100 text-success-700' : 'bg-muted text-muted-foreground'
                        }`}>
                          {location.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="outline" size="sm" onClick={() => handleSelectLocation(location)}>
                          Voir stock
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selectedLocation && (
          <div className="rounded-md border bg-card shadow-sm">
            <div className="p-5">
              <h2 className="text-lg font-semibold mb-3">Stock — {selectedLocation.nom}</h2>
              <div className="mb-4">
                <Input
                  placeholder="Rechercher un produit"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {filteredStockLevels.length === 0 ? (
                <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">
                  Aucun stock dans cette location
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Référence</th>
                        <th className="px-3 py-2 font-medium">Produit</th>
                        <th className="px-3 py-2 font-medium text-right">Quantité</th>
                        <th className="px-3 py-2 font-medium text-right">Réservé</th>
                        <th className="px-3 py-2 font-medium text-right">Disponible</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredStockLevels.map((level) => (
                        <tr key={level.id} className="hover:bg-muted/30">
                          <td className="px-3 py-2 num">{level.reference}</td>
                          <td className="px-3 py-2">{level.produit_nom}</td>
                          <td className="px-3 py-2 text-right num">{level.quantite}</td>
                          <td className="px-3 py-2 text-right num">{level.quantite_reservee}</td>
                          <td className="px-3 py-2 text-right font-medium num">{level.quantite_disponible}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
