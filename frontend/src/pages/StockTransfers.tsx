import { useState, useEffect, useMemo } from 'react';
import { stockTransferService, stockLocationService, produitService } from '../services/api';
import { fuzzyScore } from '../utils/format';
import { usePermission, Permissions } from '../hooks/usePermission';
import { toast } from 'sonner';
import { Plus, Search, ArrowRight, CheckCircle, X, Filter, RefreshCw, Package, ClipboardList, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';

interface StockLocation {
  id: number;
  code: string;
  nom: string;
}

interface Transfer {
  id: number;
  numero_transfer: string;
  location_source_id: number;
  location_destination_id: number;
  source_nom: string;
  destination_nom: string;
  date_transfer: string;
  statut: string;
  notes: string | null;
  created_at: string;
  demande_id?: number;
  demande_numero?: string;
  type?: 'proactive' | 'demande_initiated';
}

interface TransferDetail extends Transfer {
  lignes: {
    id: number;
    produit_id: number;
    produit_nom: string;
    reference: string;
    quantite_demandee: number;
    quantite_transferee: number;
  }[];
}

interface Product {
  id: number;
  reference: string;
  nom: string;
  stock: number;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning' | 'success' }> = {
  en_attente: { label: 'En attente', variant: 'warning' },
  en_transit:  { label: 'En transit',  variant: 'default' },
  completee:   { label: 'Complétée',   variant: 'success' },
  annulee:     { label: 'Annulée',     variant: 'secondary' },
};

const ALL_STATUSES = ['en_attente', 'en_transit', 'completee', 'annulee'];

export default function StockTransfers() {
  const { hasPermission, canAccessLocation: _canAccessLocation } = usePermission();
  
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Permission checks
  const canCreateProactive = hasPermission(Permissions.TRANSFERT_CREATE_PROACTIVE) || hasPermission(Permissions.TRANSFERT_CREATE);
  const canExecute = hasPermission(Permissions.TRANSFERT_EXECUTE);

  const [formData, setFormData] = useState({
    location_source_id: '',
    location_destination_id: '',
    notes: '',
    lignes: [] as Array<{ produit_id: number; quantite_demandee: number }>,
  });

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [transfersRes, locationsRes, productsRes] = await Promise.all([
        stockTransferService.getAll(),
        stockLocationService.getAll(),
        produitService.getAll(),
      ]);
      setTransfers(transfersRes.data || transfersRes);
      setLocations(locationsRes.data || locationsRes);
      setProducts(productsRes.data || productsRes);
    } catch {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const filteredTransfers = useMemo(() => {
    const byStatus = transfers.filter((t) => statusFilter === 'all' || t.statut === statusFilter);
    if (!search.trim()) return byStatus;
    return byStatus
      .map((t) => ({
        t,
        score: Math.max(
          fuzzyScore(search, t.numero_transfer),
          fuzzyScore(search, t.source_nom),
          fuzzyScore(search, t.destination_nom),
        ),
      }))
      .filter((row) => row.score > 0)
      .sort((x, y) => y.score - x.score)
      .map((row) => row.t);
  }, [transfers, search, statusFilter]);

  const handleOpenDetail = async (transfer: Transfer) => {
    try {
      const data = await stockTransferService.getById(transfer.id);
      setSelectedTransfer(data.data || data);
      setDetailOpen(true);
    } catch {
      toast.error('Erreur chargement détails');
    }
  };

  const handleComplete = async (transferId: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCompleting(transferId);
    try {
      await stockTransferService.complete(transferId);
      toast.success('Transfert complété');
      fetchAll();
      if (selectedTransfer?.id === transferId) setDetailOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur complétion transfert');
    } finally {
      setCompleting(null);
    }
  };

  const addLine = () => {
    setFormData((prev) => ({
      ...prev,
      lignes: [...prev.lignes, { produit_id: 0, quantite_demandee: 1 }],
    }));
  };

  const removeLine = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      lignes: prev.lignes.filter((_, i) => i !== index),
    }));
  };

  const updateLine = (index: number, field: string, value: any) => {
    setFormData((prev) => {
      const lignes = [...prev.lignes];
      lignes[index] = { ...lignes[index], [field]: value };
      return { ...prev, lignes };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.location_source_id === formData.location_destination_id) {
      toast.error('Source et destination doivent être différentes');
      return;
    }
    if (formData.lignes.length === 0) {
      toast.error('Ajoutez au moins une ligne');
      return;
    }
    setSubmitting(true);
    try {
      await stockTransferService.create({
        location_source_id: parseInt(formData.location_source_id),
        location_destination_id: parseInt(formData.location_destination_id),
        lignes: formData.lignes,
        notes: formData.notes || undefined,
      });
      toast.success('Transfert créé');
      setShowCreateForm(false);
      setFormData({ location_source_id: '', location_destination_id: '', notes: '', lignes: [] });
      fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur création transfert');
    } finally {
      setSubmitting(false);
    }
  };

  const StatusBadge = ({ statut }: { statut: string }) => {
    const config = STATUS_CONFIG[statut] ?? { label: statut, variant: 'outline' as const };
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  const TypeBadge = ({ transfer }: { transfer: Transfer }) => {
    if (transfer.demande_id) {
      return (
        <Badge variant="outline" className="gap-1 text-info border-info/50">
          <ClipboardList className="h-3 w-3" />
          Via demande {transfer.demande_numero}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <Package className="h-3 w-3" />
        Proactif
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 sm:h-8 sm:w-8" />
            Transferts Inter-Magasin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredTransfers.length} transfert{filteredTransfers.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreateProactive && (
          <Button onClick={() => setShowCreateForm(true)} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Nouveau Transfert
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher N°, source, destination..."
                className="pl-10 h-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Tous statuts</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>
                ))}
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2 h-10">
              <RefreshCw className="h-4 w-4" />
              Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Permission Banner */}
      {!canCreateProactive && !canExecute && (
        <Card className="bg-muted/50 border-none">
          <CardContent className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Vue en lecture seule — contactez un administrateur pour les droits de transfert
          </CardContent>
        </Card>
      )}

      {/* Transfers Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° Transfert</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Trajet</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-muted-foreground">Aucun transfert trouvé</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransfers.map((transfer) => (
                  <TableRow
                    key={transfer.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleOpenDetail(transfer)}
                  >
                    <TableCell className="font-mono text-sm font-medium">
                      {transfer.numero_transfer}
                    </TableCell>
                    <TableCell>
                      <TypeBadge transfer={transfer} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-medium">{transfer.source_nom}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium">{transfer.destination_nom}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge statut={transfer.statut} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(transfer.date_transfer).toLocaleDateString('fr-FR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {transfer.statut === 'en_attente' && canExecute && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                            disabled={completing === transfer.id}
                            onClick={(e) => handleComplete(transfer.id, e)}
                          >
                            {completing === transfer.id ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                            Compléter
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleOpenDetail(transfer); }}>
                          Détails
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          {selectedTransfer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {selectedTransfer.numero_transfer}
                </DialogTitle>
                <DialogDescription>
                  <span className="font-medium">{selectedTransfer.source_nom}</span>
                  {' → '}
                  <span className="font-medium">{selectedTransfer.destination_nom}</span>
                  {' · '}
                  <StatusBadge statut={selectedTransfer.statut} />
                </DialogDescription>
              </DialogHeader>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead>Réf.</TableHead>
                    <TableHead className="text-right">Qté demandée</TableHead>
                    <TableHead className="text-right">Qté transférée</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTransfer.lignes.map((ligne) => (
                    <TableRow key={ligne.id}>
                      <TableCell className="font-medium">{ligne.produit_nom}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{ligne.reference}</TableCell>
                      <TableCell className="text-right">{ligne.quantite_demandee}</TableCell>
                      <TableCell className="text-right">{ligne.quantite_transferee}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {selectedTransfer.notes && (
                <p className="text-sm text-muted-foreground italic">Notes: {selectedTransfer.notes}</p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Fermer</Button>
                {selectedTransfer.statut === 'en_attente' && (
                  <Button
                    className="gap-2 bg-green-600 hover:bg-green-700"
                    disabled={completing === selectedTransfer.id}
                    onClick={() => handleComplete(selectedTransfer.id)}
                  >
                    {completing === selectedTransfer.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}
                    Compléter le Transfert
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreateForm} onOpenChange={(open) => !open && setShowCreateForm(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau Transfert</DialogTitle>
            <DialogDescription>Déplacer du stock entre deux emplacements</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source *</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={formData.location_source_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, location_source_id: e.target.value }))}
                    required
                  >
                    <option value="">Sélectionner...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.nom}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Destination *</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={formData.location_destination_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, location_destination_id: e.target.value }))}
                    required
                  >
                    <option value="">Sélectionner...</option>
                    {locations
                      .filter((l) => l.id.toString() !== formData.location_source_id)
                      .map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.nom}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optionnel..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Produits à transférer</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter ligne
                  </Button>
                </div>

                {formData.lignes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Cliquez "Ajouter ligne" pour ajouter des produits
                  </p>
                )}

                <div className="space-y-2">
                  {formData.lignes.map((ligne, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={ligne.produit_id}
                        onChange={(e) => updateLine(index, 'produit_id', parseInt(e.target.value))}
                        required
                      >
                        <option value={0}>Choisir produit...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.reference} — {p.nom} (stock: {p.stock})
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Qté"
                        value={ligne.quantite_demandee}
                        min={1}
                        onChange={(e) => updateLine(index, 'quantite_demandee', parseInt(e.target.value))}
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive px-2"
                        onClick={() => removeLine(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Créer le transfert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
