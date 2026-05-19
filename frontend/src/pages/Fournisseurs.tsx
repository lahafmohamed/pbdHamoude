import { useEffect, useState } from 'react';
import { fournisseurService } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Pencil, Trash2, Truck, Mail, Phone, Loader2 } from 'lucide-react';
import { normalizeSearch } from '@/utils/format';
import { toast } from 'sonner';
import { Pagination } from '@/components/ui/pagination';

export default function Fournisseurs() {
  const [fournisseurs, setFournisseurs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingFournisseur, setEditingFournisseur] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });

  const [formData, setFormData] = useState({
    nom: '',
    contact: '',
    email: '',
    telephone: '',
    adresse: '',
    delai_livraison: 7,
    notes: '',
  });

  useEffect(() => {
    loadFournisseurs();
  }, [search, pagination.page]);

  const loadFournisseurs = async () => {
    setLoading(true);
    try {
      const result = await fournisseurService.getAll(normalizeSearch(search), pagination.page, pagination.limit);
      setFournisseurs(result.data);
      setPagination(result.pagination);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingFournisseur) {
        await fournisseurService.update(editingFournisseur.id, formData);
      } else {
        await fournisseurService.create(formData);
      }
      resetForm();
      loadFournisseurs();
      toast.success(editingFournisseur ? 'Fournisseur modifié avec succès' : 'Fournisseur ajouté avec succès');
    } catch (error) {
      console.error(error);
      toast.error('Erreur lors de l\'enregistrement');
    }
  };

  const handleEdit = (fournisseur: any) => {
    setEditingFournisseur(fournisseur);
    setFormData({
      nom: fournisseur.nom,
      contact: fournisseur.contact || '',
      email: fournisseur.email || '',
      telephone: fournisseur.telephone || '',
      adresse: fournisseur.adresse || '',
      delai_livraison: fournisseur.delai_livraison || 7,
      notes: fournisseur.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce fournisseur?')) return;
    try {
      await fournisseurService.delete(id);
      loadFournisseurs();
      toast.success('Fournisseur supprimé avec succès');
    } catch (error) {
      toast.error('Ce fournisseur est lié à des commandes');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingFournisseur(null);
    setFormData({ nom: '', contact: '', email: '', telephone: '', adresse: '', delai_livraison: 7, notes: '' });
  };

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-8 w-8" />
            Fournisseurs
          </h1>
          <p className="text-muted-foreground mt-1">Gestion de vos fournisseurs</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Ajouter Fournisseur
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un fournisseur..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Formulaire Modal */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingFournisseur ? 'Modifier Fournisseur' : 'Ajouter Fournisseur'}
            </DialogTitle>
            <DialogDescription>
              {editingFournisseur ? 'Modifiez les informations du fournisseur' : 'Remplissez les informations du nouveau fournisseur'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="nom">Nom *</Label>
                <Input
                  id="nom"
                  required
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Nom de l'entreprise"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact">Contact</Label>
                <Input
                  id="contact"
                  value={formData.contact}
                  onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                  placeholder="Personne à contacter"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@fournisseur.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telephone">Téléphone</Label>
                <Input
                  id="telephone"
                  type="tel"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                  placeholder="0XX XX XX XX XX"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delai_livraison">Délai livraison (jours)</Label>
                <Input
                  id="delai_livraison"
                  type="number"
                  min="1"
                  value={formData.delai_livraison}
                  onChange={(e) => setFormData({ ...formData, delai_livraison: parseInt(e.target.value) })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="adresse">Adresse</Label>
                <Input
                  id="adresse"
                  value={formData.adresse}
                  onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                  placeholder="Adresse complète"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Notes optionnelles"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm}>
                Annuler
              </Button>
              <Button type="submit">
                {editingFournisseur ? 'Modifier' : 'Ajouter'}
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
                  <TableHead>Nom</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Délai</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fournisseurs.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-semibold">{f.nom}</TableCell>
                    <TableCell>{f.contact || '-'}</TableCell>
                    <TableCell>
                      {f.email ? (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {f.email}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {f.telephone ? (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {f.telephone}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{f.delai_livraison || 7} jours</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(f)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(f.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {fournisseurs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Truck className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">Aucun fournisseur trouvé</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && pagination.total > 0 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          onLimitChange={(limit) => setPagination(prev => ({ ...prev, limit, page: 1 }))}
        />
      )}
    </div>
  );
}
