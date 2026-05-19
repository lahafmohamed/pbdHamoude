import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { produitService, tiersService, stockLocationService } from '../services/api';
import { Produit } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { InlineEdit } from '@/components/ui/inline-edit';
import { QuickQuantityAdjust } from '@/components/ui/quick-quantity-adjust';
import { Plus, Search, Pencil, Trash2, AlertCircle, CheckCircle, XCircle, Package, ChevronUp, ChevronDown, Download, Filter, History, Clock, ArrowUpCircle, ArrowDownCircle, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeSearch } from '@/utils/format';

interface StockLocation {
  id: number;
  code: string;
  nom: string;
  actif: boolean;
  est_principal: boolean;
}

export default function Inventaire() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduit, setEditingProduit] = useState<Produit | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [produitToDelete, setProduitToDelete] = useState<Produit | null>(null);
  
  // Stock history
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedProductForHistory, setSelectedProductForHistory] = useState<Produit | null>(null);
  const [stockHistory, setStockHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  
  // Stock adjust quantity input
  const [_adjustQuantities, _setAdjustQuantities] = useState<Record<number, string>>({});
  
  // Bulk operations state
  const [bulkAdjustQuantity, setBulkAdjustQuantity] = useState('');
  const [bulkAdjustType, setBulkAdjustType] = useState<'add' | 'subtract' | 'set'>('add');
  const [bulkCategory, setBulkCategory] = useState('');
  
  // Category filter
  const [categorieFilter, setCategorieFilter] = useState<string>('all');
  const [categories, setCategories] = useState<string[]>([]);
  
  // Fournisseurs
  const [fournisseurs, setFournisseurs] = useState<any[]>([]);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [selectedAdjustLocationId, setSelectedAdjustLocationId] = useState<string>('');
  
  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sort, setSort] = useState('nom');
  const [order, setOrder] = useState('asc');

  const [formData, setFormData] = useState({
    reference: '',
    nom: '',
    description: '',
    categorie: '',
    prix_achat: 0,
    prix_vente: 0,
    stock: 0,
    initial_stock: 0,
    location_id: '',
    stock_min: 5,
    fournisseur_id: null as number | null,
  });

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(normalizeSearch(search));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (searchParams.get('low_stock') === 'true') {
      setLowStockOnly(true);
    }
  }, [searchParams]);

  useEffect(() => {
    loadProduits();
  }, [debouncedSearch, lowStockOnly, categorieFilter, page, limit, sort, order, selectedAdjustLocationId]);

  useEffect(() => {
    loadStockLocations();
  }, []);

  useEffect(() => {
    if (showForm) {
      tiersService.getAll({ role: 'fournisseur', limit: 200 })
        .then((response) => {
          const fournisseursList = Array.isArray(response)
            ? response
            : Array.isArray(response?.data)
              ? response.data
              : [];
          setFournisseurs(fournisseursList);
        })
        .catch((error) => {
          console.error('Erreur chargement fournisseurs:', error);
          setFournisseurs([]);
        });
      loadStockLocations();
    }
  }, [showForm]);

  const getDefaultLocationId = (locations: StockLocation[]): string => {
    const activeLocations = locations.filter((location) => location.actif);
    const principal = activeLocations.find((location) => location.est_principal);
    if (principal) return String(principal.id);
    if (activeLocations[0]) return String(activeLocations[0].id);
    return '';
  };

  const loadStockLocations = async () => {
    try {
      const response = await stockLocationService.getAll();
      const locations = (response.data || response || []) as StockLocation[];
      const activeLocations = locations.filter((location) => location.actif);
      setStockLocations(activeLocations);

      const defaultLocation = getDefaultLocationId(activeLocations);
      if (!selectedAdjustLocationId && defaultLocation) {
        setSelectedAdjustLocationId(defaultLocation);
      }

      setFormData((prev) => {
        if (prev.location_id || !defaultLocation) return prev;
        return { ...prev, location_id: defaultLocation };
      });
    } catch (error) {
      console.error('Erreur chargement locations:', error);
    }
  };

  const loadProduits = async () => {
    setLoading(true);
    try {
      const categorie = categorieFilter === 'all' ? undefined : categorieFilter;
      const locationId = selectedAdjustLocationId ? parseInt(selectedAdjustLocationId, 10) : undefined;
      const response = await produitService.getAll(debouncedSearch, categorie, lowStockOnly, page, limit, sort, order, locationId);
      console.log('🔍 Produits response:', response);
      const produitsData = response?.data ?? response ?? [];
      setProduits(Array.isArray(produitsData) ? produitsData : []);
      setTotal(response.pagination?.total ?? 0);
      setTotalPages(response.pagination?.totalPages ?? 0);

      // Extract categories from data
      const cats = [...new Set((Array.isArray(produitsData) ? produitsData : []).map((p: Produit) => p.categorie).filter(Boolean))] as string[];
      setCategories(cats);
    } catch (error) {
      console.error('❌ Error loading produits:', error);
      toast.error('Erreur lors du chargement des produits');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProduit) {
        await produitService.update(editingProduit.id, {
          reference: formData.reference,
          nom: formData.nom,
          description: formData.description,
          categorie: formData.categorie,
          prix_achat: formData.prix_achat,
          prix_vente: formData.prix_vente,
          stock: formData.stock,
          stock_min: formData.stock_min,
          fournisseur_id: formData.fournisseur_id,
        });
      } else {
        await produitService.create({
          reference: formData.reference,
          nom: formData.nom,
          description: formData.description,
          categorie: formData.categorie,
          prix_achat: formData.prix_achat,
          prix_vente: formData.prix_vente,
          stock: formData.initial_stock,
          initial_stock: formData.initial_stock,
          location_id: formData.location_id ? parseInt(formData.location_id, 10) : undefined,
          stock_min: formData.stock_min,
          fournisseur_id: formData.fournisseur_id,
        });
      }
      resetForm();
      loadProduits();
      toast.success(editingProduit ? 'Produit modifié avec succès' : 'Produit ajouté avec succès');
    } catch (error) {
      console.error(error);
      toast.error('Erreur lors de l\'enregistrement');
    }
  };

  const handleEdit = (produit: Produit) => {
    setEditingProduit(produit);
    setFormData({
      reference: produit.reference,
      nom: produit.nom,
      description: produit.description || '',
      categorie: produit.categorie || '',
      prix_achat: parseFloat(produit.prix_achat as any) || 0,
      prix_vente: parseFloat(produit.prix_vente as any) || 0,
      stock: typeof produit.stock === 'string' ? parseInt(produit.stock) : produit.stock,
      initial_stock: 0,
      location_id: getDefaultLocationId(stockLocations),
      stock_min: typeof produit.stock_min === 'string' ? parseInt(produit.stock_min) : produit.stock_min,
      fournisseur_id: (produit as any).fournisseur_id || null,
    });
    setShowForm(true);
  };

  const handleDeleteClick = (produit: Produit) => {
    setProduitToDelete(produit);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!produitToDelete) return;
    setDeleting(produitToDelete.id);
    try {
      await produitService.delete(produitToDelete.id);
      loadProduits();
      toast.success('Produit supprimé avec succès');
    } catch (error) {
      toast.error('Ce produit est peut-être lié à des factures');
    } finally {
      setDeleting(null);
      setDeleteDialogOpen(false);
      setProduitToDelete(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Supprimer ${selectedIds.length} produit(s) ?`)) return;
    
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        await produitService.delete(id);
        successCount++;
      } catch (error) {
        // Continue with others
      }
    }
    
    if (successCount > 0) {
      toast.success(`${successCount} produit(s) supprimé(s) avec succès`);
      setSelectedIds([]);
      loadProduits();
    }
  };

  const handleBulkStockAdjust = async () => {
    if (selectedIds.length === 0 || !bulkAdjustQuantity) return;
    
    const quantity = parseInt(bulkAdjustQuantity);
    if (isNaN(quantity) || quantity < 0) {
      toast.error('Veuillez entrer une quantité valide');
      return;
    }

    const locationId = selectedAdjustLocationId ? parseInt(selectedAdjustLocationId, 10) : undefined;
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        let delta = quantity;
        if (bulkAdjustType === 'subtract') delta = -quantity;
        if (bulkAdjustType === 'set') {
          // For set operation, we need to get current stock first
          const product = produits.find(p => p.id === id);
          if (product) {
            const currentStock = typeof product.stock === 'string' ? parseInt(product.stock) : product.stock;
            delta = quantity - currentStock;
          }
        }
        
        await produitService.adjustStock(id, delta, locationId);
        successCount++;
      } catch (error) {
        console.error(`Failed to adjust stock for product ${id}:`, error);
      }
    }

    if (successCount > 0) {
      const operation = bulkAdjustType === 'add' ? 'ajouté(s)' : bulkAdjustType === 'subtract' ? 'retiré(s)' : 'défini(s)';
      toast.success(`Stock ${operation} pour ${successCount} produit(s) avec succès`);
      setBulkAdjustQuantity('');
      setSelectedIds([]);
      loadProduits();
    }
  };

  const handleBulkCategoryChange = async () => {
    if (selectedIds.length === 0 || !bulkCategory) return;

    let successCount = 0;
    for (const id of selectedIds) {
      try {
        await produitService.update(id, { categorie: bulkCategory });
        successCount++;
      } catch (error) {
        console.error(`Failed to update category for product ${id}:`, error);
      }
    }

    if (successCount > 0) {
      toast.success(`Catégorie changée pour ${successCount} produit(s) avec succès`);
      setBulkCategory('');
      setSelectedIds([]);
      loadProduits();
    }
  };

  const handleInlineEdit = async (productId: number, field: string, value: string) => {
    try {
      const updateData: any = {};
      
      if (field === 'nom') {
        updateData.nom = value;
      } else if (field === 'categorie') {
        updateData.categorie = value;
      } else if (field === 'prix_vente') {
        updateData.prix_vente = parseFloat(value) || 0;
      } else if (field === 'prix_achat') {
        updateData.prix_achat = parseFloat(value) || 0;
      } else if (field === 'stock_min') {
        updateData.stock_min = parseInt(value) || 5;
      }
      
      await produitService.update(productId, updateData);
      toast.success('Champ mis à jour avec succès');
      loadProduits();
    } catch (error) {
      console.error('Failed to update field:', error);
      toast.error('Erreur lors de la mise à jour');
      throw error;
    }
  };

  const resetForm = () => {
    const defaultLocation = getDefaultLocationId(stockLocations);
    setShowForm(false);
    setEditingProduit(null);
    setFormData({
      reference: '',
      nom: '',
      description: '',
      categorie: '',
      prix_achat: 0,
      prix_vente: 0,
      stock: 0,
      initial_stock: 0,
      location_id: defaultLocation,
      stock_min: 5,
      fournisseur_id: null,
    });
  };

  const getStockBadge = (stock: number, stock_min: number) => {
    if (stock <= 0) {
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Rupture</Badge>;
    }
    if (stock <= stock_min) {
      return <Badge variant="warning" className="gap-1"><AlertCircle className="h-3 w-3" /> Bas ({stock})</Badge>;
    }
    return <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> OK ({stock})</Badge>;
  };

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(column);
      setOrder('asc');
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === produits.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(produits.map(p => p.id));
    }
  };

  const handleQuickStockAdjust = async (id: number, delta: number) => {
    try {
      const locationId = selectedAdjustLocationId ? parseInt(selectedAdjustLocationId, 10) : undefined;
      await produitService.adjustStock(id, delta, locationId);
      loadProduits();
      toast.success(delta > 0 ? `Stock augmenté de ${delta}` : `Stock réduit de ${Math.abs(delta)}`);
    } catch (error) {
      toast.error('Erreur lors de l\'ajustement du stock');
    }
  };

  const openHistory = async (produit: Produit) => {
    setSelectedProductForHistory(produit);
    setHistoryDialogOpen(true);
    setLoadingHistory(true);
    try {
      const history = await produitService.getStockHistory(produit.id, 50);
      setStockHistory(history ?? []);
    } catch (error) {
      toast.error('Erreur lors du chargement de l\'historique');
      console.error(error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Référence', 'Nom', 'Catégorie', 'Prix Achat', 'Prix Vente', 'Marge', 'Stock', 'Stock Min'];
    const rows = produits.map(p => {
      const prixAchat = parseFloat(p.prix_achat as any) || 0;
      const prixVente = parseFloat(p.prix_vente as any) || 0;
      const marge = prixVente - prixAchat;
      const margePercent = prixAchat > 0 ? ((marge / prixAchat) * 100).toFixed(1) : '0';
      return [
        p.reference,
        p.nom,
        p.categorie || '',
        prixAchat.toFixed(2),
        prixVente.toFixed(2),
        `${margePercent}%`,
        typeof p.stock === 'string' ? parseInt(p.stock) : p.stock,
        typeof p.stock_min === 'string' ? parseInt(p.stock_min) : p.stock_min,
      ];
    });
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventaire_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Export CSV réussi');
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sort !== column) return <ChevronUp className="h-3 w-3 opacity-30" />;
    return order === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Package className="h-6 w-6 sm:h-8 sm:w-8" />
              Inventaire
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Gestion de vos produits et stocks</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Ajouter Produit
          </Button>
        </div>

      {/* Filtres */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-center flex-wrap">
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom ou référence..."
                className="pl-10 h-10"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            
            {/* Category Filter */}
            {categories.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={categorieFilter}
                  onChange={(e) => { setCategorieFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">Toutes catégories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            )}
            
            <Button
              variant={lowStockOnly ? "default" : "outline"}
              onClick={() => { setLowStockOnly(!lowStockOnly); setPage(1); }}
              className="gap-2 h-10"
            >
              <AlertCircle className="h-4 w-4" />
              Stock bas
            </Button>

            {stockLocations.length > 0 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="adjust-location" className="text-xs text-muted-foreground">Depot:</Label>
                <select
                  id="adjust-location"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={selectedAdjustLocationId}
                  onChange={(e) => setSelectedAdjustLocationId(e.target.value)}
                >
                  {stockLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.nom} ({location.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Bulk Actions */}
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-md flex-wrap">
                <span className="text-sm font-medium text-primary">{selectedIds.length} sélectionné(s)</span>
                
                {/* Bulk Stock Adjustment */}
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    placeholder="Quantité"
                    className="w-20 h-8 text-xs"
                    value={bulkAdjustQuantity}
                    onChange={(e) => setBulkAdjustQuantity(e.target.value)}
                  />
                  <select 
                    className="select select-xs h-8 w-16"
                    value={bulkAdjustType}
                    onChange={(e) => setBulkAdjustType(e.target.value as 'add' | 'subtract' | 'set')}
                  >
                    <option value="add">+</option>
                    <option value="subtract">-</option>
                    <option value="set">=</option>
                  </select>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkStockAdjust}
                    className="gap-1 h-8"
                    disabled={!bulkAdjustQuantity}
                  >
                    <Package className="h-3 w-3" />
                    Stock
                  </Button>
                </div>

                {/* Bulk Category Change */}
                <select 
                  className="select select-xs h-8 w-32"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                >
                  <option value="">Catégorie...</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleBulkCategoryChange}
                  className="gap-1 h-8"
                  disabled={!bulkCategory}
                >
                  <Filter className="h-3 w-3" />
                  Catégorie
                </Button>

                <Button variant="destructive" size="sm" onClick={handleBulkDelete} className="gap-2 h-8">
                  <Trash2 className="h-3 w-3" />
                  Supprimer
                </Button>

                <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])} className="gap-1 h-8">
                  X
                </Button>
              </div>
            )}

            <div className="flex-1"></div>

            {/* Export CSV */}
            <Button variant="outline" onClick={exportToCSV} className="gap-2">
              <Download className="h-4 w-4" />
              Exporter
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Formulaire Modal */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingProduit ? 'Modifier Produit' : 'Ajouter Produit'}
            </DialogTitle>
            <DialogDescription>
              {editingProduit ? 'Modifiez les informations du produit' : 'Remplissez les informations du nouveau produit'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reference">Référence *</Label>
                <Input
                  id="reference"
                  required
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="REF-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nom">Nom *</Label>
                <Input
                  id="nom"
                  required
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Nom du produit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categorie">Catégorie</Label>
                <Input
                  id="categorie"
                  value={formData.categorie}
                  onChange={(e) => setFormData({ ...formData, categorie: e.target.value })}
                  placeholder="Catégorie"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fournisseur">Fournisseur</Label>
                <select
                  id="fournisseur"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={formData.fournisseur_id || ''}
                  onChange={(e) => setFormData({ ...formData, fournisseur_id: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Aucun</option>
                  {(Array.isArray(fournisseurs) ? fournisseurs : []).map((f) => (
                    <option key={f.id} value={f.id}>{f.raison_sociale}</option>
                  ))}
                </select>
              </div>
              {editingProduit ? (
                <div className="space-y-2">
                  <Label htmlFor="stock">Stock</Label>
                  <Input
                    id="stock"
                    type="number"
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="location_id">Depot cible</Label>
                    <select
                      id="location_id"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={formData.location_id}
                      onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
                    >
                      <option value="">Selectionner...</option>
                      {stockLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.nom} ({location.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="initial_stock">Stock initial depot</Label>
                    <Input
                      id="initial_stock"
                      type="number"
                      min="0"
                      value={formData.initial_stock}
                      onChange={(e) => setFormData({ ...formData, initial_stock: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="prix_achat">Prix d'achat</Label>
                <MoneyInput
                  id="prix_achat"
                  value={formData.prix_achat || ''}
                  onChange={(v) => setFormData({ ...formData, prix_achat: parseFloat(v) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prix_vente">Prix de vente *</Label>
                <MoneyInput
                  id="prix_vente"
                  required
                  value={formData.prix_vente || ''}
                  onChange={(v) => setFormData({ ...formData, prix_vente: parseFloat(v) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock_min">Stock minimum</Label>
                <Input
                  id="stock_min"
                  type="number"
                  min="0"
                  value={formData.stock_min}
                  onChange={(e) => setFormData({ ...formData, stock_min: parseInt(e.target.value) || 5 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Description optionnelle"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm}>
                Annuler
              </Button>
              <Button type="submit">
                {editingProduit ? 'Modifier' : 'Ajouter'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tableau */}
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
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === produits.length && produits.length > 0}
                      onChange={selectAll}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                    />
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort('reference')}>
                    <div className="flex items-center gap-1">Référence <SortIcon column="reference" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort('nom')}>
                    <div className="flex items-center gap-1">Nom <SortIcon column="nom" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort('categorie')}>
                    <div className="flex items-center gap-1">Catégorie <SortIcon column="categorie" /></div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted text-right" onClick={() => handleSort('prix_vente')}>
                    <div className="flex items-center gap-1 justify-end">Prix Vente <SortIcon column="prix_vente" /></div>
                  </TableHead>
                  <TableHead className="text-right">Marge</TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted" onClick={() => handleSort('stock')}>
                    <div className="flex items-center gap-1">Stock <SortIcon column="stock" /></div>
                  </TableHead>
                  <TableHead>Ajuster</TableHead>
                  <TableHead className="text-right">Historique</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produits.map((p) => {
                  const prixVente = parseFloat(p.prix_vente as any) || 0;
                  const prixAchat = parseFloat(p.prix_achat as any) || 0;
                  const marge = prixVente - prixAchat;
                  const margePercent = prixAchat > 0 ? ((marge / prixAchat) * 100).toFixed(1) : '0';
                  const stock = typeof p.stock === 'string' ? parseInt(p.stock) : p.stock;
                  const stockMin = typeof p.stock_min === 'string' ? parseInt(p.stock_min) : p.stock_min;
                  
                  return (
                  <TableRow key={p.id} className={`${selectedIds.includes(p.id) ? 'bg-primary/5' : ''} hover:bg-muted/50 transition-colors`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleSelection(p.id)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{p.reference}</TableCell>
                    <TableCell className="font-semibold">
                      <InlineEdit
                        value={p.nom}
                        onSave={(value) => handleInlineEdit(p.id, 'nom', value)}
                        placeholder="Nom du produit"
                        displayClassName="font-semibold"
                      />
                    </TableCell>
                    <TableCell>
                      <InlineEdit
                        value={p.categorie || ''}
                        onSave={(value) => handleInlineEdit(p.id, 'categorie', value)}
                        placeholder="Catégorie"
                      />
                    </TableCell>
                    <TableCell className="font-bold text-right">
                      <InlineEdit
                        value={prixVente.toFixed(2)}
                        onSave={(value) => handleInlineEdit(p.id, 'prix_vente', value)}
                        type="number"
                        placeholder="0.00"
                        displayClassName="font-bold text-right"
                      />
                      {' XOF'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-medium text-muted-foreground">
                        +{margePercent}%
                      </span>
                    </TableCell>
                    <TableCell>{getStockBadge(stock, stockMin)}</TableCell>
                    <TableCell>
                      <QuickQuantityAdjust
                        currentStock={stock}
                        onAdjust={(delta) => handleQuickStockAdjust(p.id, delta)}
                        size="sm"
                        showStockLevel={false}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openHistory(p)}
                        className="gap-1"
                      >
                        <History className="h-4 w-4" />
                        <span className="text-xs">Voir</span>
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClick(p)}
                          disabled={deleting === p.id}
                        >
                          {deleting === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {produits?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">Aucun produit trouvé</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer le produit "{produitToDelete?.nom}" ({produitToDelete?.reference}) ?
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting === produitToDelete?.id}>
              {deleting === produitToDelete?.id ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  Suppression...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Supprimer
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock History Modal */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Historique des mouvements - {selectedProductForHistory?.nom} ({selectedProductForHistory?.reference})
            </DialogTitle>
            <DialogDescription>
              Stock actuel: <span className="font-bold">{selectedProductForHistory?.stock}</span> unités
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto">
            {loadingHistory ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
            ) : stockHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock className="h-12 w-12 mb-2 opacity-50" />
                <p>Aucun mouvement enregistré</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stockHistory.map((movement) => {
                  const quantite = parseInt(movement.quantite);
                  const isPositive = quantite > 0;
                  
                  const getMovementIcon = () => {
                    switch (movement.type_mouvement) {
                      case 'vente':
                        return <ArrowDownCircle className="h-4 w-4 text-red-500" />;
                      case 'retour':
                        return <ArrowUpCircle className="h-4 w-4 text-green-500" />;
                      case 'ajustement':
                        return <RefreshCw className="h-4 w-4 text-yellow-500" />;
                      default:
                        return <Clock className="h-4 w-4 text-gray-500" />;
                    }
                  };

                  const getMovementLabel = () => {
                    const labels: Record<string, string> = {
                      vente: 'Vente',
                      retour: 'Retour',
                      ajustement: 'Ajustement',
                      commande: 'Commande',
                      perte: 'Perte',
                      autre: 'Autre',
                    };
                    return labels[movement.type_mouvement] || 'Autre';
                  };

                  return (
                    <div
                      key={movement.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className="mt-1">
                        {getMovementIcon()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{getMovementLabel()}</span>
                          <span className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {isPositive ? '+' : ''}{quantite}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">
                            {new Date(movement.date_mouvement).toLocaleDateString('fr-FR', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Stock: {movement.stock_avant} → {movement.stock_apres}
                          </span>
                        </div>
                        {movement.raison && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            Raison: {movement.raison}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {!loading && total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
        />
      )}
      </div>
    </div>
  );
}
