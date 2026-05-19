import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { tiersService, acompteService, acompteFournisseurService } from '../services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft, Users, Truck, Wallet,
  Plus, RefreshCw, GitMerge, Phone, Mail, MapPin, FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { formatFCFA } from '@/lib/utils';

const METHODES = ['espece', 'carte', 'cheque', 'virement', 'mobile_money', 'orange_money', 'mtn_money', 'wave'];

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  facture_client:    { label: 'Facture',         color: 'text-red-600' },
  paiement_client:  { label: 'Paiement',         color: 'text-green-600' },
  avoir_client:     { label: 'Avoir',            color: 'text-blue-600' },
  acompte_client:   { label: 'Acompte reçu',     color: 'text-green-600' },
  facture_fourn:    { label: 'Facture fourn.',   color: 'text-orange-600' },
  paiement_fourn:   { label: 'Paiement fourn.',  color: 'text-green-600' },
  acompte_fourn:    { label: 'Acompte versé',    color: 'text-orange-600' },
};

export default function TiersDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tiersId = parseInt(id!);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [showAcompteClient, setShowAcompteClient] = useState(false);
  const [showAcompteForun, setShowAcompteFourn] = useState(false);
  const [showCompensation, setShowCompensation] = useState(false);
  const [acompteForm, setAcompteForm] = useState({ montant: '', methode: 'espece', notes: '', magasin_id: '', reference_number: '' });
  const [magasinsList, setMagasinsList] = useState<Array<{ id: number; nom: string; code: string }>>([]);

  useEffect(() => {
    fetch('/api/caisse/magasins', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setMagasinsList(d.data);
          if (d.data.length === 1) {
            setAcompteForm(p => ({ ...p, magasin_id: String(d.data[0].id) }));
          }
        }
      })
      .catch(() => {});
  }, []);
  const [compForm, setCompForm] = useState({ date: new Date().toISOString().split('T')[0], montant: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const [compensations, setCompensations] = useState<any[]>([]);
  const [acomptesClient, setAcomptesClient] = useState<any[]>([]);
  const [acomptesFourn, setAcomptesFourn] = useState<any[]>([]);
  const [refundTarget, setRefundTarget] = useState<{ kind: 'client' | 'fournisseur'; acompte: any } | null>(null);
  const [refundForm, setRefundForm] = useState({ montant: '', methode: 'espece', session_caisse_id: '', notes: '' });

  useEffect(() => { loadData(); }, [tiersId, dateFrom, dateTo]);
  useEffect(() => { tiersService.getCompensations(tiersId).then(setCompensations).catch(() => {}); }, [tiersId]);
  useEffect(() => { loadAcomptes(); }, [tiersId]);

  const loadAcomptes = async () => {
    try {
      const [cli, fou] = await Promise.all([
        fetch(`/api/tiers/${tiersId}/acomptes-client/disponibles`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/tiers/${tiersId}/acomptes-fournisseur/disponibles`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      setAcomptesClient(cli?.data || []);
      setAcomptesFourn(fou?.data || []);
    } catch { /* silent */ }
  };

  const openRefund = (kind: 'client' | 'fournisseur', acompte: any) => {
    setRefundTarget({ kind, acompte });
    setRefundForm({
      montant: String(acompte.montant_restant),
      methode: acompte.methode_paiement || 'espece',
      session_caisse_id: '',
      notes: '',
    });
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTarget) return;
    setSubmitting(true);
    try {
      const payload = {
        montant: parseFloat(refundForm.montant),
        methode_paiement: refundForm.methode,
        session_caisse_id: refundForm.session_caisse_id ? parseInt(refundForm.session_caisse_id) : undefined,
        notes: refundForm.notes || undefined,
      };
      if (refundTarget.kind === 'client') {
        await acompteService.refund(refundTarget.acompte.id, payload);
      } else {
        await acompteFournisseurService.refund(refundTarget.acompte.id, payload);
      }
      toast.success('Remboursement enregistré');
      setRefundTarget(null);
      loadData();
      loadAcomptes();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur remboursement');
    } finally {
      setSubmitting(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await tiersService.getCompte(tiersId, dateFrom || undefined, dateTo || undefined);
      setData(res);
    } catch { toast.error('Erreur chargement compte tiers'); }
    finally { setLoading(false); }
  };

  const handleAcompteClient = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    const idemKey = `aco-${tiersId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      await tiersService.recordAcompteClient(tiersId, {
        montant: parseFloat(acompteForm.montant),
        methode_paiement: acompteForm.methode,
        notes: acompteForm.notes || undefined,
        magasin_id: acompteForm.magasin_id ? parseInt(acompteForm.magasin_id) : undefined,
        reference_number: acompteForm.reference_number || undefined,
        idempotency_key: idemKey,
      });
      toast.success('Acompte client enregistré');
      setShowAcompteClient(false);
      setAcompteForm(p => ({ ...p, montant: '', notes: '', reference_number: '' }));
      loadData();
      loadAcomptes();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Erreur'); }
    finally { setSubmitting(false); }
  };

  const handleAcompteFourn = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    try {
      await tiersService.recordAcompteFournisseur(tiersId, {
        montant: parseFloat(acompteForm.montant),
        methode_paiement: acompteForm.methode,
        notes: acompteForm.notes || undefined,
        magasin_id: acompteForm.magasin_id ? parseInt(acompteForm.magasin_id) : undefined,
        reference_number: acompteForm.reference_number || undefined,
      });
      toast.success('Acompte fournisseur enregistré');
      setShowAcompteFourn(false);
      setAcompteForm(p => ({ ...p, montant: '', notes: '', reference_number: '' }));
      loadData();
      loadAcomptes();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Erreur'); }
    finally { setSubmitting(false); }
  };

  const handleCompensation = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    try {
      await tiersService.createCompensation(tiersId, { date_compensation: compForm.date, montant: parseFloat(compForm.montant), notes: compForm.notes });
      toast.success('Compensation enregistrée');
      setShowCompensation(false);
      setCompForm({ date: new Date().toISOString().split('T')[0], montant: '', notes: '' });
      loadData();
      const comps = await tiersService.getCompensations(tiersId);
      setCompensations(comps);
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Erreur compensation'); }
    finally { setSubmitting(false); }
  };

  const handleRecompute = async () => {
    try {
      await tiersService.recomputeAllocation(tiersId);
      toast.success('Allocation FIFO recalculée');
      loadData();
    } catch { toast.error('Erreur recalcul'); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Chargement...</div>;
  if (!data) return <div className="p-8 text-center text-muted-foreground">Tiers introuvable</div>;

  const { tiers, totaux, mouvements } = data;
  const soldeNet = totaux.solde_net;
  // Convention: solde_net = solde_client - solde_fournisseur
  //   > 0 → ils nous doivent (créance nette, favorable)
  //   < 0 → nous leur devons (dette nette, défavorable)
  const soldeNetColor = soldeNet > 0 ? 'text-green-600' : soldeNet < 0 ? 'text-red-600' : 'text-muted-foreground';
  const canCompensate = tiers.est_client && tiers.est_fournisseur && totaux.client.solde_client > 0 && totaux.fournisseur.solde_fournisseur > 0;
  const maxComp = canCompensate ? Math.min(totaux.client.solde_client, totaux.fournisseur.solde_fournisseur) : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/tiers')}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{tiers.raison_sociale}{tiers.prenom ? ` ${tiers.prenom}` : ''}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono text-muted-foreground">{tiers.code}</span>
            {tiers.est_client && <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 text-xs py-0"><Users className="h-3 w-3 mr-1" />Client</Badge>}
            {tiers.est_fournisseur && <Badge variant="outline" className="text-orange-700 border-orange-200 bg-orange-50 text-xs py-0"><Truck className="h-3 w-3 mr-1" />Fournisseur</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {tiers.est_client && (
            <Button variant="outline" size="sm" onClick={() => setShowAcompteClient(true)} className="gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> Acompte client
            </Button>
          )}
          {tiers.est_fournisseur && (
            <Button variant="outline" size="sm" onClick={() => setShowAcompteFourn(true)} className="gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> Acompte fourn.
            </Button>
          )}
          {canCompensate && (
            <Button size="sm" onClick={() => { setCompForm(p => ({ ...p, montant: maxComp.toString() })); setShowCompensation(true); }} className="gap-1 text-xs bg-purple-600 hover:bg-purple-700">
              <GitMerge className="h-3.5 w-3.5" /> Compenser
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRecompute} title="Recalculer allocation FIFO">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Contact info */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {tiers.telephone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{tiers.telephone}</span>}
            {tiers.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{tiers.email}</span>}
            {tiers.adresse && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{tiers.adresse}</span>}
            {tiers.nif && <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />NIF: {tiers.nif}</span>}
            {tiers.rccm && <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />RCCM: {tiers.rccm}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Net balance summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiers.est_client && (
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users className="h-3 w-3" /> Solde client</div>
              <div className={`text-xl font-bold ${totaux.client.solde_client > 0 ? 'text-red-600' : totaux.client.solde_client < 0 ? 'text-green-600' : ''}`}>
                {formatFCFA(totaux.client.solde_client)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Facturé: {formatFCFA(totaux.client.total_facture)} · Payé: {formatFCFA(totaux.client.total_paye)}
              </div>
            </CardContent>
          </Card>
        )}
        {tiers.est_fournisseur && (
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Truck className="h-3 w-3" /> Solde fournisseur</div>
              <div className={`text-xl font-bold ${totaux.fournisseur.solde_fournisseur > 0 ? 'text-orange-600' : ''}`}>
                {formatFCFA(totaux.fournisseur.solde_fournisseur)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Facturé: {formatFCFA(totaux.fournisseur.total_facture_fourn)} · Payé: {formatFCFA(totaux.fournisseur.total_paye_fourn)}
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="border-2 border-primary/20">
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Wallet className="h-3 w-3" /> Solde NET</div>
            <div className={`text-2xl font-bold ${soldeNetColor}`}>{formatFCFA(soldeNet)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {soldeNet > 0 ? 'Il nous doit' : soldeNet < 0 ? 'Nous lui devons' : 'Compte soldé'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Date filter */}
      <div className="flex gap-3 items-end">
        <div>
          <Label className="text-xs">Du</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div>
          <Label className="text-xs">Au</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs">Réinitialiser</Button>
        )}
      </div>

      {/* Unified ledger */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">Ledger unifié ({mouvements.length} mouvements)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Rôle</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Référence</TableHead>
                <TableHead className="text-xs text-right">Débit</TableHead>
                <TableHead className="text-xs text-right">Crédit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mouvements.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">Aucun mouvement</TableCell></TableRow>
              ) : mouvements.map((m: any, i: number) => {
                const meta = TYPE_LABELS[m.type] || { label: m.type, color: '' };
                return (
                  <TableRow key={i} className="text-sm">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{m.date ? m.date.substring(0,10) : '—'}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${m.role === 'Client' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                        {m.role}
                      </span>
                    </TableCell>
                    <TableCell className={`text-xs font-medium ${meta.color}`}>{meta.label}</TableCell>
                    <TableCell className="text-xs font-mono">{m.reference || m.libelle}</TableCell>
                    <TableCell className="text-right text-xs text-red-600">{m.debit > 0 ? formatFCFA(m.debit) : ''}</TableCell>
                    <TableCell className="text-right text-xs text-green-600">{m.credit > 0 ? formatFCFA(m.credit) : ''}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Acomptes actifs (client + fournisseur) */}
      {(acomptesClient.length > 0 || acomptesFourn.length > 0) && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1">
              <Wallet className="h-4 w-4 text-blue-600" /> Acomptes actifs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Côté</TableHead>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Méthode</TableHead>
                  <TableHead className="text-xs text-right">Initial</TableHead>
                  <TableHead className="text-xs text-right">Restant</TableHead>
                  <TableHead className="text-xs">Statut</TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acomptesClient.map((a: any) => (
                  <TableRow key={`c-${a.id}`} className="text-sm">
                    <TableCell><span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Client</span></TableCell>
                    <TableCell className="text-xs font-mono">{a.id}</TableCell>
                    <TableCell className="text-xs">{(a.date_acompte || '').substring(0,10)}</TableCell>
                    <TableCell className="text-xs">{a.methode_paiement}</TableCell>
                    <TableCell className="text-right text-xs">{formatFCFA(a.montant)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{formatFCFA(a.montant_restant)}</TableCell>
                    <TableCell className="text-xs">{a.statut}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openRefund('client', a)}>Rembourser</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {acomptesFourn.map((a: any) => (
                  <TableRow key={`f-${a.id}`} className="text-sm">
                    <TableCell><span className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">Fourn.</span></TableCell>
                    <TableCell className="text-xs font-mono">{a.id}</TableCell>
                    <TableCell className="text-xs">{(a.date_acompte || '').substring(0,10)}</TableCell>
                    <TableCell className="text-xs">{a.methode_paiement}</TableCell>
                    <TableCell className="text-right text-xs">{formatFCFA(a.montant)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{formatFCFA(a.montant_restant)}</TableCell>
                    <TableCell className="text-xs">{a.statut}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openRefund('fournisseur', a)}>Rembourser</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Compensations history */}
      {compensations.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1"><GitMerge className="h-4 w-4 text-purple-600" /> Compensations ({compensations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-right">Montant</TableHead>
                  <TableHead className="text-xs">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compensations.map((c: any) => (
                  <TableRow key={c.id} className="text-sm">
                    <TableCell className="text-xs">{c.date_compensation}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-purple-700">{formatFCFA(c.montant)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.notes || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Acompte client dialog */}
      <Dialog open={showAcompteClient} onOpenChange={setShowAcompteClient}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Acompte client reçu</DialogTitle></DialogHeader>
          <form onSubmit={handleAcompteClient} className="space-y-3">
            <div><Label>Montant *</Label><MoneyInput value={acompteForm.montant} onChange={v => setAcompteForm(p => ({ ...p, montant: v }))} required placeholder="0" /></div>
            <div>
              <Label>Méthode</Label>
              <select value={acompteForm.methode} onChange={e => setAcompteForm(p => ({ ...p, methode: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                {METHODES.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <Label>Magasin {acompteForm.methode === 'espece' && <span className="text-red-500">*</span>}</Label>
              <select
                value={acompteForm.magasin_id}
                onChange={e => setAcompteForm(p => ({ ...p, magasin_id: e.target.value }))}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                required={acompteForm.methode === 'espece'}
              >
                <option value="">— Choisir —</option>
                {magasinsList.map(m => <option key={m.id} value={m.id}>{m.code} - {m.nom}</option>)}
              </select>
              {acompteForm.methode === 'espece' && (
                <p className="text-xs text-amber-600 mt-1">Caisse du magasin doit être ouverte.</p>
              )}
            </div>
            {acompteForm.methode !== 'espece' && (
              <div>
                <Label>Référence (chèque/virement)</Label>
                <Input value={acompteForm.reference_number} onChange={e => setAcompteForm(p => ({ ...p, reference_number: e.target.value }))} placeholder="N° de pièce" />
              </div>
            )}
            <div><Label>Notes</Label><Input value={acompteForm.notes} onChange={e => setAcompteForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAcompteClient(false)}>Annuler</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Acompte fournisseur dialog */}
      <Dialog open={showAcompteForun} onOpenChange={setShowAcompteFourn}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Acompte versé au fournisseur</DialogTitle></DialogHeader>
          <form onSubmit={handleAcompteFourn} className="space-y-3">
            <div><Label>Montant *</Label><MoneyInput value={acompteForm.montant} onChange={v => setAcompteForm(p => ({ ...p, montant: v }))} required placeholder="0" /></div>
            <div>
              <Label>Méthode</Label>
              <select value={acompteForm.methode} onChange={e => setAcompteForm(p => ({ ...p, methode: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                {METHODES.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <Label>Magasin {acompteForm.methode === 'espece' && <span className="text-red-500">*</span>}</Label>
              <select
                value={acompteForm.magasin_id}
                onChange={e => setAcompteForm(p => ({ ...p, magasin_id: e.target.value }))}
                required={acompteForm.methode === 'espece'}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">-- Sélectionner --</option>
                {magasinsList.map(m => <option key={m.id} value={m.id}>{m.nom} ({m.code})</option>)}
              </select>
              {acompteForm.methode === 'espece' && (
                <p className="text-xs text-muted-foreground mt-1">Session caisse de ce magasin doit être ouverte.</p>
              )}
            </div>
            {acompteForm.methode !== 'espece' && (
              <div>
                <Label>Référence</Label>
                <Input value={acompteForm.reference_number} onChange={e => setAcompteForm(p => ({ ...p, reference_number: e.target.value }))} placeholder="N° de pièce" />
              </div>
            )}
            <div><Label>Notes</Label><Input value={acompteForm.notes} onChange={e => setAcompteForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAcompteFourn(false)}>Annuler</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Compensation dialog */}
      <Dialog open={showCompensation} onOpenChange={setShowCompensation}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><GitMerge className="h-4 w-4 text-purple-600" /> Compensation (netting)</DialogTitle></DialogHeader>
          <div className="text-xs text-muted-foreground mb-3 p-3 bg-purple-50 rounded-md">
            Créance client : <strong>{formatFCFA(totaux.client.solde_client)}</strong><br />
            Dette fournisseur : <strong>{formatFCFA(totaux.fournisseur.solde_fournisseur)}</strong><br />
            Maximum compensable : <strong className="text-purple-700">{formatFCFA(maxComp)}</strong>
          </div>
          <form onSubmit={handleCompensation} className="space-y-3">
            <div><Label>Date *</Label><Input type="date" value={compForm.date} onChange={e => setCompForm(p => ({ ...p, date: e.target.value }))} required /></div>
            <div>
              <Label>Montant à compenser *</Label>
              <MoneyInput value={compForm.montant} onChange={v => setCompForm(p => ({ ...p, montant: v }))} required placeholder="0" />
              <p className="text-xs text-muted-foreground mt-0.5">Maximum: {formatFCFA(maxComp)}</p>
            </div>
            <div><Label>Notes</Label><Input value={compForm.notes} onChange={e => setCompForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCompensation(false)}>Annuler</Button>
              <Button type="submit" disabled={submitting} className="bg-purple-600 hover:bg-purple-700">{submitting ? 'Enregistrement...' : 'Compenser'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Refund acompte dialog */}
      <Dialog open={refundTarget !== null} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Rembourser acompte {refundTarget?.kind === 'client' ? 'client' : 'fournisseur'} #{refundTarget?.acompte?.id}
            </DialogTitle>
          </DialogHeader>
          {refundTarget && (
            <form onSubmit={handleRefund} className="space-y-3">
              <div className="text-xs p-2 bg-muted rounded">
                Restant : <strong>{formatFCFA(refundTarget.acompte.montant_restant)}</strong>
                {refundTarget.kind === 'fournisseur' && (
                  <div className="mt-1 text-orange-600">Fournisseur restitue le cash → encaissement caisse.</div>
                )}
                {refundTarget.kind === 'client' && (
                  <div className="mt-1 text-blue-600">Cash sort de la caisse vers le client.</div>
                )}
              </div>
              <div>
                <Label>Montant *</Label>
                <MoneyInput value={refundForm.montant}
                  onChange={v => setRefundForm(p => ({ ...p, montant: v }))}
                  required placeholder="0" />
              </div>
              <div>
                <Label>Méthode</Label>
                <select value={refundForm.methode}
                  onChange={e => setRefundForm(p => ({ ...p, methode: e.target.value }))}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                  {METHODES.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <Label>Session caisse (optionnel)</Label>
                <Input type="number" value={refundForm.session_caisse_id}
                  onChange={e => setRefundForm(p => ({ ...p, session_caisse_id: e.target.value }))}
                  placeholder="Auto si magasin acompte" />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Si vide, session ouverte du magasin de l'acompte utilisée.
                </p>
              </div>
              <div><Label>Notes</Label><Input value={refundForm.notes} onChange={e => setRefundForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRefundTarget(null)}>Annuler</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Remboursement...' : 'Rembourser'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
