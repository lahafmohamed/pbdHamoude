import { useState, useEffect } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { factureFournisseurService, receptionService, produitService, acompteFournisseurService } from '../services/api';
import { TiersPicker } from '../components/TiersPicker';
import { Tiers } from '../types';
import { toast } from 'sonner';
import { MoneyInput } from '../components/ui/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatFCFA } from '../utils/format';


interface Reception {
  id: number;
  numero_reception: string;
}

interface FactureFournisseur {
  id: number;
  tiers_id: number;
  fournisseur_id?: number;
  fournisseur_nom: string;
  reception_id: number | null;
  numero_reception: string | null;
  numero_facture_fournisseur: string;
  numero_facture_interne: string;
  date_facture: string;
  date_echeance: string | null;
  sous_total: string;
  tva: string;
  total: string;
  montant_paye: string;
  reste_due: string;
  statut: string;
  condition_paiement: string | null;
  notes: string | null;
  created_at: string;
}

interface FactureDetail extends FactureFournisseur {
  lignes: {
    id: number;
    produit_id: number | null;
    produit_nom: string | null;
    produit_reference: string | null;
    description: string | null;
    quantite: number;
    prix_unitaire: string;
    tva_taux: string;
    total_ligne: string;
  }[];
}

interface Product {
  id: number;
  reference: string;
  nom: string;
}

const SELECT_CLS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const BADGE_BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const STATUT_BADGE: Record<string, string> = {
  en_attente: 'bg-warning-100 text-warning-800',
  validee: 'bg-info-100 text-info-700',
  partiellement_payee: 'bg-primary-100 text-primary-700',
  payee: 'bg-success-100 text-success-700',
  annulee: 'bg-muted text-muted-foreground',
};

const TABLE_HEAD = 'px-3 py-2 font-medium';

export default function FacturesFournisseur() {
  const [factures, setFactures] = useState<FactureFournisseur[]>([]);
  const [selectedFacture, setSelectedFacture] = useState<FactureDetail | null>(null);
  const [selectedFournisseur, setSelectedFournisseur] = useState<Tiers | null>(null);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatut, setFilterStatut] = useState<string>('');

  const [formData, setFormData] = useState({
    reception_id: '',
    numero_facture_fournisseur: '',
    date_facture: new Date().toISOString().split('T')[0],
    date_echeance: '',
    condition_paiement: '',
    notes: '',
    lignes: [] as Array<{ produit_id: number | null; description: string; quantite: number; prix_unitaire: number; tva_taux: number }>,
  });

  const [paymentData, setPaymentData] = useState({
    montant: '',
    methode_paiement: 'virement',
    reference: '',
  });

  const [showAcompteApply, setShowAcompteApply] = useState(false);
  const [acomptesDispo, setAcomptesDispo] = useState<Array<{ id: number; montant: string; montant_restant: string; date_acompte: string; methode_paiement: string }>>([]);
  const [acompteApplyForm, setAcompteApplyForm] = useState({ acompte_id: '', montant: '' });

  useEffect(() => {
    fetchFactures();
    fetchReceptions();
    fetchProducts();
  }, [filterStatut]);

  const fetchFactures = async () => {
    try {
      const data = await factureFournisseurService.getAll(undefined, filterStatut || undefined, undefined, 1, 20);
      setFactures(data.data || data);
    } catch (error: any) {
      console.error('Error fetching factures fournisseur:', error);
      toast.error(error.response?.data?.error || 'Erreur chargement factures');
    } finally {
      setLoading(false);
    }
  };

  const fetchReceptions = async () => {
    try {
      const data = await receptionService.getAll();
      setReceptions(data.data || data);
    } catch (error: any) {
      console.error('Error fetching réceptions:', error);
      toast.error(error.response?.data?.error || 'Erreur chargement réceptions');
    }
  };

  const fetchProducts = async () => {
    try {
      const data = await produitService.getAll();
      setProducts(data.data || data);
    } catch {
      toast.error('Erreur chargement produits');
    }
  };

  const handleSelectFacture = async (facture: FactureFournisseur) => {
    try {
      const data = await factureFournisseurService.getById(facture.id);
      setSelectedFacture(data.data || data);
    } catch {
      toast.error('Erreur chargement détails');
    }
  };

  const addLine = () => {
    setFormData({
      ...formData,
      lignes: [...formData.lignes, { produit_id: null, description: '', quantite: 1, prix_unitaire: 0, tva_taux: 19 }],
    });
  };

  const removeLine = (index: number) => {
    const newLignes = formData.lignes.filter((_, i) => i !== index);
    setFormData({ ...formData, lignes: newLignes });
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLignes = [...formData.lignes];
    newLignes[index] = { ...newLignes[index], [field]: value };
    setFormData({ ...formData, lignes: newLignes });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (!selectedFournisseur || !formData.numero_facture_fournisseur || !formData.date_facture) {
      toast.error('Remplissez tous les champs obligatoires');
      setSubmitting(false);
      return;
    }

    if (formData.lignes.length === 0) {
      toast.error('Ajoutez au moins une ligne');
      setSubmitting(false);
      return;
    }

    try {
      await factureFournisseurService.create({
        tiers_id: selectedFournisseur!.id,
        reception_id: formData.reception_id ? parseInt(formData.reception_id) : undefined,
        numero_facture_fournisseur: formData.numero_facture_fournisseur,
        date_facture: formData.date_facture,
        date_echeance: formData.date_echeance || undefined,
        condition_paiement: formData.condition_paiement || undefined,
        lignes: formData.lignes,
        notes: formData.notes || undefined,
      });

      toast.success('Facture fournisseur créée');
      setShowCreateForm(false);
      setSelectedFournisseur(null);
      setFormData({
        reception_id: '',
        numero_facture_fournisseur: '',
        date_facture: new Date().toISOString().split('T')[0],
        date_echeance: '',
        condition_paiement: '',
        notes: '',
        lignes: [],
      });
      fetchFactures();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur création facture');
    } finally {
      setSubmitting(false);
    }
  };

  const openAcompteApply = async () => {
    if (!selectedFacture) return;
    try {
      const list = await acompteFournisseurService.listForFournisseur(selectedFacture.tiers_id);
      setAcomptesDispo(list);
      setAcompteApplyForm({ acompte_id: '', montant: '' });
      setShowAcompteApply(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur chargement acomptes');
    }
  };

  const handleAcompteApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFacture || !acompteApplyForm.acompte_id || !acompteApplyForm.montant) return;
    setSubmitting(true);
    try {
      await acompteFournisseurService.apply(parseInt(acompteApplyForm.acompte_id), {
        facture_id: Number(selectedFacture.id),
        montant: parseFloat(acompteApplyForm.montant),
      });
      toast.success('Acompte appliqué');
      setShowAcompteApply(false);
      handleSelectFacture(selectedFacture);
      fetchFactures();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur application acompte');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFacture || !paymentData.montant) return;

    setSubmitting(true);
    try {
      await factureFournisseurService.recordPayment(Number(selectedFacture.id), {
        montant: Number(paymentData.montant),
        methode_paiement: paymentData.methode_paiement,
        reference: paymentData.reference || undefined,
      });
      toast.success('Paiement enregistré');
      setShowPaymentForm(false);
      setPaymentData({ montant: '', methode_paiement: 'virement', reference: '' });
      handleSelectFacture(selectedFacture);
      fetchFactures();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erreur paiement');
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
        <h1 className="text-2xl font-semibold tracking-tight">Factures fournisseur</h1>
        <div className="flex gap-2">
          <select
            className={SELECT_CLS + ' w-auto'}
            value={filterStatut}
            onChange={(e) => setFilterStatut(e.target.value)}
          >
            <option value="">Tous les statuts</option>
            <option value="en_attente">En attente</option>
            <option value="validee">Validée</option>
            <option value="partiellement_payee">Partiellement payée</option>
            <option value="payee">Payée</option>
            <option value="annulee">Annulée</option>
          </select>
          <Button onClick={() => setShowCreateForm(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nouvelle facture
          </Button>
        </div>
      </div>

      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvelle facture fournisseur</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Fournisseur *</Label>
                <TiersPicker role="fournisseur" value={selectedFournisseur} onChange={setSelectedFournisseur} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ff-num">N° facture fournisseur *</Label>
                <Input id="ff-num" value={formData.numero_facture_fournisseur} onChange={(e) => setFormData({ ...formData, numero_facture_fournisseur: e.target.value })} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ff-date">Date facture *</Label>
                <Input id="ff-date" type="date" value={formData.date_facture} onChange={(e) => setFormData({ ...formData, date_facture: e.target.value })} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ff-ech">Date échéance</Label>
                <Input id="ff-ech" type="date" value={formData.date_echeance} onChange={(e) => setFormData({ ...formData, date_echeance: e.target.value })} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ff-rec">Réception liée</Label>
                <select
                  id="ff-rec"
                  className={SELECT_CLS}
                  value={formData.reception_id}
                  onChange={(e) => setFormData({ ...formData, reception_id: e.target.value })}
                >
                  <option value="">Aucune</option>
                  {receptions.map((r) => (
                    <option key={r.id} value={r.id}>{r.numero_reception}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ff-cond">Condition de paiement</Label>
                <Input id="ff-cond" value={formData.condition_paiement} onChange={(e) => setFormData({ ...formData, condition_paiement: e.target.value })} placeholder="ex: 30 jours" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Lignes de facture</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Ajouter
                </Button>
              </div>

              <div className="space-y-2">
                {formData.lignes.map((ligne, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2">
                    <select
                      className={SELECT_CLS + ' col-span-4'}
                      value={ligne.produit_id || ''}
                      onChange={(e) => updateLine(index, 'produit_id', e.target.value ? parseInt(e.target.value) : null)}
                    >
                      <option value="">Produit…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom}</option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      className="col-span-2 num"
                      placeholder="Qté"
                      value={ligne.quantite}
                      min={1}
                      onChange={(e) => updateLine(index, 'quantite', parseInt(e.target.value))}
                    />
                    <Input
                      type="number"
                      className="col-span-2 num"
                      placeholder="Prix unit."
                      value={ligne.prix_unitaire}
                      step={0.01}
                      onChange={(e) => updateLine(index, 'prix_unitaire', parseFloat(e.target.value))}
                    />
                    <Input
                      type="number"
                      className="col-span-2 num"
                      placeholder="TVA %"
                      value={ligne.tva_taux}
                      onChange={(e) => updateLine(index, 'tva_taux', parseFloat(e.target.value))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="col-span-1 h-9 w-9 p-0 text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                      onClick={() => removeLine(index)}
                      aria-label="Supprimer la ligne"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ff-notes">Notes</Label>
              <Textarea id="ff-notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
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

      <Dialog open={showPaymentForm && !!selectedFacture} onOpenChange={(open) => { if (!open) setShowPaymentForm(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enregistrer paiement</DialogTitle>
          </DialogHeader>
          {selectedFacture && (
            <form onSubmit={handlePayment} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Montant *</Label>
                <MoneyInput
                  value={paymentData.montant}
                  onChange={(v) => setPaymentData({ ...paymentData, montant: v })}
                  required
                />
                <p className="text-xs text-muted-foreground num">Reste dû: {formatFCFA(selectedFacture.reste_due)}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pay-meth">Méthode de paiement *</Label>
                <select
                  id="pay-meth"
                  className={SELECT_CLS}
                  value={paymentData.methode_paiement}
                  onChange={(e) => setPaymentData({ ...paymentData, methode_paiement: e.target.value })}
                  required
                >
                  <option value="virement">Virement</option>
                  <option value="cheque">Chèque</option>
                  <option value="espece">Espèces</option>
                  <option value="carte">Carte</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Référence</Label>
                <Input id="pay-ref" value={paymentData.reference} onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })} />
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setShowPaymentForm(false)}>Annuler</Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enregistrement…
                    </>
                  ) : 'Enregistrer'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAcompteApply && !!selectedFacture} onOpenChange={(open) => { if (!open) setShowAcompteApply(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedFacture && `Appliquer acompte sur facture ${selectedFacture.numero_facture_interne}`}
            </DialogTitle>
          </DialogHeader>
          {selectedFacture && (
            acomptesDispo.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">Aucun acompte disponible pour ce fournisseur.</p>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setShowAcompteApply(false)}>Fermer</Button>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={handleAcompteApply} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ac-id">Acompte *</Label>
                  <select
                    id="ac-id"
                    className={SELECT_CLS}
                    value={acompteApplyForm.acompte_id}
                    onChange={e => {
                      const ac = acomptesDispo.find(a => a.id === parseInt(e.target.value));
                      setAcompteApplyForm({
                        acompte_id: e.target.value,
                        montant: ac ? String(Math.min(parseFloat(ac.montant_restant), parseFloat(selectedFacture.reste_due))) : '',
                      });
                    }}
                    required
                  >
                    <option value="">— Sélectionner —</option>
                    {acomptesDispo.map(a => (
                      <option key={a.id} value={a.id}>
                        #{a.id} — {new Date(a.date_acompte).toLocaleDateString('fr-FR')} — restant {formatFCFA(a.montant_restant)} ({a.methode_paiement})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Montant à appliquer *</Label>
                  <MoneyInput
                    value={acompteApplyForm.montant}
                    onChange={v => setAcompteApplyForm(p => ({ ...p, montant: v }))}
                    required
                  />
                  <p className="text-xs text-muted-foreground num">
                    Reste dû facture: {formatFCFA(selectedFacture.reste_due)}
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setShowAcompteApply(false)}>Annuler</Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Application…
                      </>
                    ) : 'Appliquer'}
                  </Button>
                </DialogFooter>
              </form>
            )
          )}
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Factures</h2>
            {factures.length === 0 ? (
              <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">Aucune facture fournisseur</div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className={TABLE_HEAD}>N° interne</th>
                      <th className={TABLE_HEAD}>Fournisseur</th>
                      <th className={TABLE_HEAD}>Date</th>
                      <th className={TABLE_HEAD + ' text-right'}>Total</th>
                      <th className={TABLE_HEAD}>Statut</th>
                      <th className={TABLE_HEAD}>Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {factures.map((facture) => (
                      <tr key={facture.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium text-xs num">{facture.numero_facture_interne}</td>
                        <td className="px-3 py-2">{facture.fournisseur_nom}</td>
                        <td className="px-3 py-2 text-xs num">{new Date(facture.date_facture).toLocaleDateString('fr-FR')}</td>
                        <td className="px-3 py-2 text-right font-medium num">{formatFCFA(facture.total)}</td>
                        <td className="px-3 py-2">
                          <span className={`${BADGE_BASE} ${STATUT_BADGE[facture.statut] || 'bg-muted text-muted-foreground'}`}>{facture.statut}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="outline" size="sm" onClick={() => handleSelectFacture(facture)}>Voir</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selectedFacture && (
          <div className="rounded-md border bg-card shadow-sm">
            <div className="p-5">
              <h2 className="text-lg font-semibold mb-3">{selectedFacture.numero_facture_interne}</h2>
              <div className="mb-4 space-y-1 text-sm">
                <p>Fournisseur: <strong>{selectedFacture.fournisseur_nom}</strong></p>
                <p>N° facture: <strong>{selectedFacture.numero_facture_fournisseur}</strong></p>
                <p>Date: <strong>{new Date(selectedFacture.date_facture).toLocaleDateString('fr-FR')}</strong></p>
                {selectedFacture.date_echeance && (
                  <p>Échéance: <strong>{new Date(selectedFacture.date_echeance).toLocaleDateString('fr-FR')}</strong></p>
                )}
                <p>Statut: <span className={`${BADGE_BASE} ${STATUT_BADGE[selectedFacture.statut] || 'bg-muted text-muted-foreground'}`}>{selectedFacture.statut}</span></p>
              </div>

              <div className="overflow-x-auto rounded-md border mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className={TABLE_HEAD}>Produit</th>
                      <th className={TABLE_HEAD + ' text-right'}>Qté</th>
                      <th className={TABLE_HEAD + ' text-right'}>Prix unit.</th>
                      <th className={TABLE_HEAD + ' text-right'}>TVA %</th>
                      <th className={TABLE_HEAD + ' text-right'}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedFacture.lignes.map((ligne) => (
                      <tr key={ligne.id}>
                        <td className="px-3 py-2">{ligne.produit_nom || ligne.description}</td>
                        <td className="px-3 py-2 text-right num">{ligne.quantite}</td>
                        <td className="px-3 py-2 text-right num">{formatFCFA(ligne.prix_unitaire)}</td>
                        <td className="px-3 py-2 text-right num">{ligne.tva_taux}%</td>
                        <td className="px-3 py-2 text-right font-medium num">{formatFCFA(ligne.total_ligne)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                {selectedFacture.statut !== 'payee' && (
                  <>
                    <Button onClick={() => setShowPaymentForm(true)} className="bg-success-600 hover:bg-success-700 text-white">
                      Enregistrer paiement
                    </Button>
                    <Button variant="outline" onClick={openAcompteApply}>
                      Appliquer acompte
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
