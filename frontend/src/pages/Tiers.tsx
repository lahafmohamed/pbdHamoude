import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tiersService } from '../services/api';
import { Tiers } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Plus, Search, Pencil, Trash2, Users, Truck, UserCheck, Eye, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { formatFCFA } from '@/lib/utils';

type RoleFilter = 'all' | 'client' | 'fournisseur' | 'mixte';

const ROLE_TABS: { value: RoleFilter; label: string; icon: any }[] = [
  { value: 'all', label: 'Tous', icon: UserCheck },
  { value: 'client', label: 'Clients', icon: Users },
  { value: 'fournisseur', label: 'Fournisseurs', icon: Truck },
  { value: 'mixte', label: 'Mixtes', icon: UserCheck },
];

export default function TiersPage() {
  const navigate = useNavigate();
  const [tiers, setTiers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sort, setSort] = useState('raison_sociale');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tiers | null>(null);
  const [saving, setSaving] = useState(false);

  const blankForm = {
    raison_sociale: '', prenom: '', telephone: '', email: '', adresse: '',
    nif: '', rccm: '', est_client: true, est_fournisseur: false,
    credit_max: 0, delai_livraison: 7, notes: '',
  };
  const [formData, setFormData] = useState(blankForm);

  useEffect(() => { loadTiers(); }, [search, role, page, sort, order]);

  const loadTiers = async () => {
    setLoading(true);
    try {
      const res = await tiersService.getAll({ search, role, page, limit, sort, order });
      const rows = res?.data ?? res ?? [];
      setTiers(Array.isArray(rows) ? rows : []);
      setTotal(res?.pagination?.total ?? 0);
      setTotalPages(res?.pagination?.totalPages ?? 0);
    } catch { toast.error('Erreur chargement contacts'); }
    finally { setLoading(false); }
  };

  const handleSort = (col: string) => {
    if (sort === col) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setOrder('asc'); }
  };

  const openCreate = () => { setEditing(null); setFormData(blankForm); setShowForm(true); };
  const openEdit = (t: Tiers) => {
    setEditing(t);
    setFormData({
      raison_sociale: t.raison_sociale, prenom: t.prenom || '', telephone: t.telephone || '',
      email: t.email || '', adresse: t.adresse || '', nif: t.nif || '', rccm: t.rccm || '',
      est_client: t.est_client, est_fournisseur: t.est_fournisseur,
      credit_max: t.credit_max || 0, delai_livraison: t.delai_livraison || 7, notes: t.notes || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.est_client && !formData.est_fournisseur) {
      toast.error('Sélectionnez au moins un rôle'); return;
    }
    setSaving(true);
    try {
      if (editing) await tiersService.update(editing.id, formData);
      else await tiersService.create(formData);
      toast.success(editing ? 'Contact modifié' : 'Contact créé');
      setShowForm(false);
      loadTiers();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur enregistrement');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce contact ?')) return;
    try {
      await tiersService.delete(id);
      toast.success('Contact supprimé');
      loadTiers();
    } catch { toast.error('Impossible de supprimer ce contact'); }
  };

  const soldeNetColor = (net: number) =>
    net > 0 ? 'text-red-600' : net < 0 ? 'text-green-600' : 'text-muted-foreground';

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCheck className="h-6 w-6" /> Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} contacts au total</p>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Nouveau contact
        </Button>
      </div>

      {/* Role tabs */}
      <div className="flex gap-1 mb-4 bg-muted/40 rounded-lg p-1 w-fit">
        {ROLE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              onClick={() => { setRole(tab.value); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${role === tab.value ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Search */}
          <div className="p-4 border-b">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Nom, téléphone, NIF, code..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-10 sm:pl-10"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort('code')}>
                  <span className="flex items-center gap-1">Code <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort('raison_sociale')}>
                  <span className="flex items-center gap-1">Raison sociale <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Rôles</TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('solde_client_actuel')}>
                  <span className="flex items-center justify-end gap-1">Solde client <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="text-right">Solde fourn.</TableHead>
                <TableHead className="text-right font-semibold">Solde net</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : tiers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucun contact trouvé</TableCell></TableRow>
              ) : tiers.map(t => {
                const soldeNet = (t.solde_net ?? (parseFloat(t.solde_client_live ?? 0) - parseFloat(t.solde_fournisseur_live ?? 0)));
                return (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.raison_sociale}</div>
                      {t.prenom && <div className="text-xs text-muted-foreground">{t.prenom}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{t.telephone || '—'}</div>
                      {t.email && <div className="text-xs text-muted-foreground truncate max-w-[160px]">{t.email}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {t.est_client && <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 text-xs py-0">Client</Badge>}
                        {t.est_fournisseur && <Badge variant="outline" className="text-orange-700 border-orange-200 bg-orange-50 text-xs py-0">Fourn.</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {t.est_client ? formatFCFA(t.solde_client_live ?? t.solde_client_actuel) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {t.est_fournisseur ? formatFCFA(t.solde_fournisseur_live ?? t.solde_fournisseur_actuel) : '—'}
                    </TableCell>
                    <TableCell className={`text-right font-semibold text-sm ${soldeNetColor(soldeNet)}`}>
                      {(t.est_client || t.est_fournisseur) ? formatFCFA(soldeNet) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/tiers/${t.id}`)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>

          {totalPages > 1 && (
            <div className="p-4 border-t">
              <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier le contact' : 'Nouveau contact'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Raison sociale *</Label>
              <Input value={formData.raison_sociale} onChange={e => setFormData(p => ({ ...p, raison_sociale: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Prénom / Contact</Label>
                <Input value={formData.prenom} onChange={e => setFormData(p => ({ ...p, prenom: e.target.value }))} />
              </div>
              <div>
                <Label>Téléphone</Label>
                <Input value={formData.telephone} onChange={e => setFormData(p => ({ ...p, telephone: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <Label>Adresse</Label>
              <Input value={formData.adresse} onChange={e => setFormData(p => ({ ...p, adresse: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>NIF</Label>
                <Input value={formData.nif} onChange={e => setFormData(p => ({ ...p, nif: e.target.value }))} />
              </div>
              <div>
                <Label>RCCM</Label>
                <Input value={formData.rccm} onChange={e => setFormData(p => ({ ...p, rccm: e.target.value }))} />
              </div>
            </div>
            {formData.est_client && (
              <div>
                <Label>Plafond de crédit (max: 15 000 000 FCFA)</Label>
                <Input
                  type="number"
                  min="0"
                  max="15000000"
                  value={formData.credit_max}
                  onChange={e => setFormData(p => ({ ...p, credit_max: Math.min(15000000, parseFloat(e.target.value) || 0) }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">Maximum autorisé: 15 000 000 FCFA</p>
              </div>
            )}
            <div>
              <Label className="mb-2 block">Rôles *</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.est_client} onChange={e => setFormData(p => ({ ...p, est_client: e.target.checked }))} className="rounded" />
                  <span className="text-sm flex items-center gap-1"><Users className="h-3.5 w-3.5 text-blue-600" /> Client</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.est_fournisseur} onChange={e => setFormData(p => ({ ...p, est_fournisseur: e.target.checked }))} className="rounded" />
                  <span className="text-sm flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-orange-600" /> Fournisseur</span>
                </label>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Annuler</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : editing ? 'Modifier' : 'Créer'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
