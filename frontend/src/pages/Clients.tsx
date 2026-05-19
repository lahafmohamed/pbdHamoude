import { useEffect, useState } from 'react';
import { clientService, compteClientService } from '../services/api';
import { Client } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Plus, Search, Pencil, Trash2, Users, Mail, Phone, Eye, Wallet, ArrowUpDown, Calendar, Banknote, Loader2 } from 'lucide-react';
import { normalizeSearch } from '@/utils/format';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { formatFCFA, formatDateFR } from '@/lib/utils';

export default function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Account dialog
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [accountBalance, setAccountBalance] = useState<any>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountStatement, setAccountStatement] = useState<any>(null);

  // Sorting & filtering
  const [sort, setSort] = useState('nom');
  const [order, setOrder] = useState('asc');
  const [statutSoldeFilter, setStatutSoldeFilter] = useState<'all' | 'debiteur' | 'crediteur' | 'solde'>('all');

  // Date filter for account
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Acompte form
  const [showAcompteForm, setShowAcompteForm] = useState(false);
  const [acompteMontant, setAcompteMontant] = useState('');
  const [acompteMethode, setAcompteMethode] = useState('espece');
  const [acompteNotes, setAcompteNotes] = useState('');
  const [acompteLoading, setAcompteLoading] = useState(false);

  const [formData, setFormData] = useState({
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
    adresse: '',
    nif: '',
  });

  useEffect(() => {
    loadClients();
  }, [search, page, limit, sort, order, statutSoldeFilter]);

  const loadClients = async () => {
    setLoading(true);
    try {
      const response = await clientService.getAllWithBalance(
        normalizeSearch(search),
        page,
        limit,
        sort,
        order,
        statutSoldeFilter === 'all' ? undefined : statutSoldeFilter
      );
      const clientData = response?.data ?? response ?? [];
      setClients(Array.isArray(clientData) ? clientData : []);
      setTotal(response.pagination?.total ?? 0);
      setTotalPages(response.pagination?.totalPages ?? 0);
    } catch (error) {
      console.error('❌ Error loading clients:', error);
      toast.error('Erreur lors du chargement des clients');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingClient) {
        await clientService.update(editingClient.id, formData as any);
      } else {
        await clientService.create(formData as any);
      }
      resetForm();
      loadClients();
      toast.success(editingClient ? 'Client modifié avec succès' : 'Client ajouté avec succès');
    } catch (error) {
      console.error(error);
      toast.error('Erreur lors de l\'enregistrement');
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      nom: client.nom,
      prenom: client.prenom || '',
      email: client.email || '',
      telephone: client.telephone || '',
      adresse: client.adresse || '',
      nif: client.nif || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce client?')) return;
    setDeleting(id);
    try {
      await clientService.delete(id);
      loadClients();
      toast.success('Client supprimé avec succès');
    } catch (error) {
      toast.error('Ce client est peut-être lié à des factures');
    } finally {
      setDeleting(null);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingClient(null);
    setFormData({ nom: '', prenom: '', email: '', telephone: '', adresse: '', nif: '' });
  };

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(column);
      setOrder('asc');
    }
  };

  const viewClientAccount = async (client: Client) => {
    setSelectedClient(client);
    setShowAccountDialog(true);
    setAccountLoading(true);
    setDateFrom('');
    setDateTo('');
    try {
      const data = await clientService.getCompte(client.id);
      setAccountBalance(data.totaux);
      setAccountStatement(data);
    } catch (error) {
      console.error('❌ Error loading account:', error);
      toast.error('Erreur lors du chargement du compte');
    } finally {
      setAccountLoading(false);
    }
  };

  const loadCompteWithDates = async () => {
    if (!selectedClient) return;
    setAccountLoading(true);
    try {
      const data = await clientService.getCompte(selectedClient.id, dateFrom || undefined, dateTo || undefined);
      setAccountBalance(data.totaux);
      setAccountStatement({ ...data, mouvements: data.mouvements });
    } catch (error) {
      console.error('❌ Error loading account:', error);
      toast.error('Erreur lors du chargement du compte');
    } finally {
      setAccountLoading(false);
    }
  };

  const handleRecordAcompte = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    const montant = parseFloat(acompteMontant);
    if (!montant || montant <= 0) {
      toast.error('Le montant doit être supérieur à 0');
      return;
    }
    setAcompteLoading(true);
    try {
      await compteClientService.recordAcompte(selectedClient.id, {
        montant,
        methode_paiement: acompteMethode,
        notes: acompteNotes || undefined,
      });
      toast.success('Versement enregistré avec succès');
      setAcompteMontant('');
      setAcompteNotes('');
      setShowAcompteForm(false);
      // Refresh account view and client list
      await loadCompteWithDates();
      await loadClients();
    } catch (error: any) {
      console.error('❌ Error recording acompte:', error);
      toast.error(error?.response?.data?.error || 'Erreur lors de l\'enregistrement du versement');
    } finally {
      setAcompteLoading(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Users className="h-6 w-6 sm:h-8 sm:w-8" />
              Clients
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Gestion de vos clients</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Ajouter Client
          </Button>
        </div>

      {/* Search & Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un client..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-full sm:w-48"
              value={statutSoldeFilter}
              onChange={(e) => { setStatutSoldeFilter(e.target.value as any); setPage(1); }}
            >
              <option value="all">Tous les clients</option>
              <option value="debiteur">Débiteurs</option>
              <option value="crediteur">Créditeurs</option>
              <option value="solde">Soldés</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Formulaire Modal */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? 'Modifier Client' : 'Ajouter Client'}
            </DialogTitle>
            <DialogDescription>
              {editingClient ? 'Modifiez les informations du client' : 'Remplissez les informations du nouveau client'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="nom">Nom *</Label>
                <Input
                  id="nom"
                  required
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Nom"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prenom">Prénom</Label>
                <Input
                  id="prenom"
                  value={formData.prenom}
                  onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                  placeholder="Prénom"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
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
                <Label htmlFor="nif">NIF</Label>
                <Input
                  id="nif"
                  value={formData.nif}
                  onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                  placeholder="Numéro d'identification fiscale"
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
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm}>
                Annuler
              </Button>
              <Button type="submit">
                {editingClient ? 'Modifier' : 'Ajouter'}
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
                  <TableHead>Prénom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>NIF</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('solde')}
                  >
                    <div className="flex items-center gap-1">
                      Solde
                      {sort === 'solde' && <ArrowUpDown className="h-3 w-3" />}
                    </div>
                  </TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c: any) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => viewClientAccount(c)}
                  >
                    <TableCell className="font-semibold">{c.nom}</TableCell>
                    <TableCell>{c.prenom || '-'}</TableCell>
                    <TableCell>
                      {c.email ? (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {c.email}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {c.telephone ? (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {c.telephone}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.nif || '-'}</TableCell>
                    <TableCell className={`font-mono text-sm ${(c.solde || 0) > 0 ? 'text-red-600' : (c.solde || 0) < 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {(c.solde || 0) !== 0 ? formatFCFA(c.solde) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          c.statut_solde === 'debiteur' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50' :
                          c.statut_solde === 'crediteur' ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-50' :
                          'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-50'
                        }
                      >
                        {c.statut_solde === 'debiteur' ? 'Doit' : c.statut_solde === 'crediteur' ? 'Avoir' : 'Soldé'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.derniere_activite ? formatDateFR(c.derniere_activite) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => viewClientAccount(c)}
                          className="gap-1 h-8 px-2"
                          title="Voir le compte"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span className="hidden xl:inline text-xs">Compte</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(c.id)}
                          disabled={deleting === c.id}
                        >
                          {deleting === c.id ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {clients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">Aucun client trouvé</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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

      {/* Account Dialog */}
      <Dialog open={showAccountDialog} onOpenChange={(open) => !open && setShowAccountDialog(false)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Compte Client: {selectedClient?.nom} {selectedClient?.prenom}
            </DialogTitle>
            <DialogDescription>
              Relevé de compte et historique des mouvements
            </DialogDescription>
          </DialogHeader>

          {accountLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : accountBalance ? (
            <div className="space-y-6">
              {/* KPI Tiles */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Total facturé</p>
                    <p className="text-xl font-bold">{formatFCFA(accountBalance.total_facture)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Total payé</p>
                    <p className="text-xl font-bold text-green-600">{formatFCFA(accountBalance.total_paye)}</p>
                    {accountBalance.surplus > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        dont {formatFCFA(accountBalance.surplus)} non alloué
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Solde</p>
                    <p className={`text-2xl font-bold ${
                      accountBalance.solde > 0 ? 'text-red-600' :
                      accountBalance.solde < 0 ? 'text-green-600' :
                      'text-muted-foreground'
                    }`}>
                      {accountBalance.solde === 0 ? 'Compte soldé' :
                       accountBalance.solde > 0 ? `Le client doit ${formatFCFA(accountBalance.solde)}` :
                       `Nous devons ${formatFCFA(Math.abs(accountBalance.solde))} au client`}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Acompte button + inline form */}
              <div className="flex flex-col gap-3">
                {!showAcompteForm ? (
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto self-start gap-2"
                    onClick={() => setShowAcompteForm(true)}
                  >
                    <Banknote className="h-4 w-4" />
                    Nouveau versement anticipé
                  </Button>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="pt-6">
                      <form onSubmit={handleRecordAcompte} className="flex flex-col sm:flex-row gap-3 items-end">
                        <div className="space-y-1 flex-1 w-full">
                          <Label htmlFor="acompte-montant" className="text-xs text-muted-foreground">Montant</Label>
                          <MoneyInput
                            id="acompte-montant"
                            placeholder="100 000"
                            value={acompteMontant}
                            onChange={(v) => setAcompteMontant(v)}
                            required
                          />
                        </div>
                        <div className="space-y-1 w-full sm:w-40">
                          <Label htmlFor="acompte-methode" className="text-xs text-muted-foreground">Méthode</Label>
                          <select
                            id="acompte-methode"
                            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={acompteMethode}
                            onChange={(e) => setAcompteMethode(e.target.value)}
                          >
                            <option value="espece">Espèces</option>
                            <option value="carte">Carte</option>
                            <option value="cheque">Chèque</option>
                            <option value="virement">Virement</option>
                          </select>
                        </div>
                        <div className="space-y-1 flex-1 w-full">
                          <Label htmlFor="acompte-notes" className="text-xs text-muted-foreground">Notes (opt.)</Label>
                          <Input
                            id="acompte-notes"
                            placeholder="Notes..."
                            value={acompteNotes}
                            onChange={(e) => setAcompteNotes(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAcompteForm(false)}
                            disabled={acompteLoading}
                          >
                            Annuler
                          </Button>
                          <Button type="submit" size="sm" disabled={acompteLoading} className="gap-1">
                            {acompteLoading && <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                            Enregistrer
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Date Filter */}
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="date-from" className="text-xs text-muted-foreground">Du</Label>
                  <Input
                    id="date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1 flex-1">
                  <Label htmlFor="date-to" className="text-xs text-muted-foreground">Au</Label>
                  <Input
                    id="date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadCompteWithDates}
                  disabled={accountLoading}
                  className="h-10"
                >
                  <Calendar className="h-4 w-4 mr-1" />
                  Filtrer
                </Button>
              </div>

              {/* Ledger */}
              {accountStatement?.mouvements && accountStatement.mouvements.length > 0 ? (
                <Card>
                  <CardContent className="p-0">
                    <div className="max-h-[400px] overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead className="w-24">Date</TableHead>
                            <TableHead className="w-24">Type</TableHead>
                            <TableHead>Référence</TableHead>
                            <TableHead>Libellé</TableHead>
                            <TableHead className="text-right">Débit</TableHead>
                            <TableHead className="text-right">Crédit</TableHead>
                            <TableHead className="text-right">Progression</TableHead>
                            <TableHead className="text-right">Solde après</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {accountStatement.mouvements.map((m: any, idx: number) => (
                            <TableRow key={`${m.type}-${m.reference}-${idx}`}>
                              <TableCell className="text-sm whitespace-nowrap">{formatDateFR(m.date)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={
                                  m.type === 'facture' ? 'border-red-200 bg-red-50 text-red-700' :
                                  m.type === 'paiement' ? 'border-green-200 bg-green-50 text-green-700' :
                                  m.type === 'avoir' ? 'border-blue-200 bg-blue-50 text-blue-700' :
                                  'border-gray-200 bg-gray-50 text-gray-700'
                                }>
                                  {m.type === 'facture' ? 'Facture' :
                                   m.type === 'paiement' ? 'Paiement' :
                                   m.type === 'avoir' ? 'Avoir' :
                                   m.type === 'acompte' ? 'Acompte' : m.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{m.reference || '-'}</TableCell>
                              <TableCell className="text-sm">{m.libelle || '-'}</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {m.debit > 0 ? <span className="text-red-600">{formatFCFA(m.debit)}</span> : '—'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {m.credit > 0 ? <span className="text-green-600">{formatFCFA(m.credit)}</span> : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {m.type === 'facture' && m.montant_paye !== null && m.restant !== null ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <div className="w-16 bg-gray-200 rounded-full h-2">
                                      <div 
                                        className="bg-green-500 h-2 rounded-full" 
                                        style={{ width: `${Math.min((m.montant_paye / (m.montant_paye + m.restant)) * 100, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {formatFCFA(m.montant_paye)}/{formatFCFA(m.montant_paye + m.restant)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className={`text-right font-mono text-sm font-semibold ${
                                m.solde_apres > 0 ? 'text-red-600' :
                                m.solde_apres < 0 ? 'text-green-600' :
                                'text-muted-foreground'
                              }`}>
                                {formatFCFA(m.solde_apres)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Wallet className="h-12 w-12 text-muted-foreground/50" />
                      <p className="text-muted-foreground">Aucun mouvement pour ce client</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Wallet className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Aucune information de compte disponible</p>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowAccountDialog(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
