import { useState, useEffect } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { employeService } from '../services/api';
import { toast } from 'sonner';
import { MoneyInput } from '../components/ui/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatFCFA } from '../utils/format';

interface Employe {
  id: number;
  utilisateur_id: number | null;
  username: string | null;
  matricule: string;
  nom_complet: string;
  poste: string | null;
  departement: string | null;
  date_embauche: string;
  date_naissance: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  salaire_base: string | null;
  commission_taux: string;
  actif: boolean;
  created_at: string;
}

interface CommissionSummary {
  total_ventes: number;
  total_montant_ventes: string;
  total_commissions: string;
  commissions_en_attente: number;
  commissions_payees: number;
}

const SELECT_CLS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function Employes() {
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [selectedEmploye, setSelectedEmploye] = useState<Employe | null>(null);
  const [commissionSummary, setCommissionSummary] = useState<CommissionSummary | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [filterDepartement, setFilterDepartement] = useState<string>('');

  const [formData, setFormData] = useState({
    matricule: '',
    nom_complet: '',
    poste: '',
    departement: '',
    date_embauche: new Date().toISOString().split('T')[0],
    date_naissance: '',
    telephone: '',
    email: '',
    adresse: '',
    salaire_base: '',
    commission_taux: '0',
  });

  useEffect(() => {
    fetchEmployes();
  }, [filterDepartement]);

  const fetchEmployes = async () => {
    try {
      const data = await employeService.getAll(undefined, filterDepartement || undefined);
      setEmployes(data.data || data);
    } catch {
      toast.error('Erreur chargement employés');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEmploye = async (employe: Employe) => {
    setSelectedEmploye(employe);
    try {
      const dateDebut = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const dateFin = new Date().toISOString().split('T')[0];
      const data = await employeService.getCommissionSummary(employe.id, dateDebut, dateFin);
      setCommissionSummary(data.data || data);
    } catch {
      toast.error('Erreur chargement commissions');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await employeService.create({
        ...formData,
        salaire_base: formData.salaire_base ? parseFloat(formData.salaire_base) : undefined,
        commission_taux: parseFloat(formData.commission_taux),
      });

      toast.success('Employé créé');
      setShowCreateForm(false);
      setFormData({
        matricule: '',
        nom_complet: '',
        poste: '',
        departement: '',
        date_embauche: new Date().toISOString().split('T')[0],
        date_naissance: '',
        telephone: '',
        email: '',
        adresse: '',
        salaire_base: '',
        commission_taux: '0',
      });
      fetchEmployes();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur création employé');
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
        <h1 className="text-2xl font-semibold tracking-tight">Gestion des employés</h1>
        <div className="flex gap-2">
          <select
            className={SELECT_CLS + ' w-auto'}
            value={filterDepartement}
            onChange={(e) => setFilterDepartement(e.target.value)}
          >
            <option value="">Tous les départements</option>
            <option value="Vente">Vente</option>
            <option value="Magasin">Magasin</option>
            <option value="Administration">Administration</option>
          </select>
          <Button onClick={() => setShowCreateForm(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nouvel employé
          </Button>
        </div>
      </div>

      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvel employé</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="emp-matricule">Matricule *</Label>
                <Input id="emp-matricule" value={formData.matricule} onChange={(e) => setFormData({ ...formData, matricule: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-nom">Nom complet *</Label>
                <Input id="emp-nom" value={formData.nom_complet} onChange={(e) => setFormData({ ...formData, nom_complet: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-poste">Poste</Label>
                <Input id="emp-poste" value={formData.poste} onChange={(e) => setFormData({ ...formData, poste: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-dept">Département</Label>
                <select id="emp-dept" className={SELECT_CLS} value={formData.departement} onChange={(e) => setFormData({ ...formData, departement: e.target.value })}>
                  <option value="">Sélectionner…</option>
                  <option value="Vente">Vente</option>
                  <option value="Magasin">Magasin</option>
                  <option value="Administration">Administration</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-embauche">Date d'embauche *</Label>
                <Input id="emp-embauche" type="date" value={formData.date_embauche} onChange={(e) => setFormData({ ...formData, date_embauche: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-naissance">Date de naissance</Label>
                <Input id="emp-naissance" type="date" value={formData.date_naissance} onChange={(e) => setFormData({ ...formData, date_naissance: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-tel">Téléphone</Label>
                <Input id="emp-tel" value={formData.telephone} onChange={(e) => setFormData({ ...formData, telephone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-email">Email</Label>
                <Input id="emp-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Salaire de base</Label>
                <MoneyInput value={formData.salaire_base} onChange={(v) => setFormData({ ...formData, salaire_base: v })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-com">Taux commission (%)</Label>
                <Input id="emp-com" type="number" value={formData.commission_taux} onChange={(e) => setFormData({ ...formData, commission_taux: e.target.value })} step={0.01} min={0} max={100} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="emp-adresse">Adresse</Label>
              <Textarea id="emp-adresse" value={formData.adresse} onChange={(e) => setFormData({ ...formData, adresse: e.target.value })} />
            </div>

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
            <h2 className="text-lg font-semibold mb-3">Employés</h2>
            {employes.length === 0 ? (
              <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">Aucun employé</div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Matricule</th>
                      <th className="px-3 py-2 font-medium">Nom</th>
                      <th className="px-3 py-2 font-medium">Poste</th>
                      <th className="px-3 py-2 font-medium">Dépt.</th>
                      <th className="px-3 py-2 font-medium">Commission</th>
                      <th className="px-3 py-2 font-medium">Statut</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employes.map((employe) => (
                      <tr key={employe.id} className={`hover:bg-muted/30 ${selectedEmploye?.id === employe.id ? 'bg-primary/10' : ''}`}>
                        <td className="px-3 py-2 font-medium text-xs num">{employe.matricule}</td>
                        <td className="px-3 py-2">{employe.nom_complet}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{employe.poste || '—'}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                            {employe.departement || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs num">{employe.commission_taux}%</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            employe.actif ? 'bg-success-100 text-success-700' : 'bg-muted text-muted-foreground'
                          }`}>
                            {employe.actif ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="outline" size="sm" onClick={() => handleSelectEmploye(employe)}>
                            Détails
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selectedEmploye && (
          <div className="rounded-md border bg-card shadow-sm">
            <div className="p-5">
              <h2 className="text-lg font-semibold mb-3">{selectedEmploye.nom_complet}</h2>
              <div className="mb-4 space-y-1 text-sm">
                <p>Matricule: <strong>{selectedEmploye.matricule}</strong></p>
                <p>Poste: <strong>{selectedEmploye.poste || '—'}</strong></p>
                <p>Département: <strong>{selectedEmploye.departement || '—'}</strong></p>
                <p>Date d'embauche: <strong>{new Date(selectedEmploye.date_embauche).toLocaleDateString('fr-FR')}</strong></p>
                {selectedEmploye.telephone && <p>Téléphone: <strong>{selectedEmploye.telephone}</strong></p>}
                {selectedEmploye.email && <p>Email: <strong>{selectedEmploye.email}</strong></p>}
                {selectedEmploye.salaire_base && <p>Salaire de base: <strong className="num">{formatFCFA(selectedEmploye.salaire_base)}</strong></p>}
                <p>Taux commission: <strong className="num">{selectedEmploye.commission_taux}%</strong></p>
              </div>

              {commissionSummary && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Résumé des commissions (année en cours)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-md border bg-muted/30 p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Total ventes</div>
                      <div className="text-xl font-semibold num">{commissionSummary.total_ventes}</div>
                      <div className="text-xs text-muted-foreground num">{formatFCFA(commissionSummary.total_montant_ventes)}</div>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Total commissions</div>
                      <div className="text-xl font-semibold text-success-700 num">{formatFCFA(commissionSummary.total_commissions)}</div>
                      <div className="text-xs text-muted-foreground num">{commissionSummary.commissions_payees} payées</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
