import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { factureService } from '../services/api';
import { Facture } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import { formatXOF, normalizeSearch } from '@/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Plus, Search as SearchIcon, FileText, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Factures() {
  const navigate = useNavigate();
  const [factures, setFactures] = useState<Facture[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    loadFactures();
  }, [search, statusFilter, page, limit]);

  const loadFactures = async () => {
    setLoading(true);
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      const response = await factureService.getAll(normalizeSearch(search), status, page, limit);
      console.log(' Factures response:', response);
      const factureData = response?.data ?? response ?? [];
      setFactures(Array.isArray(factureData) ? factureData : []);
      setTotal(response.pagination?.total ?? 0);
      setTotalPages(response.pagination?.totalPages ?? 0);
    } catch (error) {
      console.error(' Error loading factures:', error);
      toast.error('Erreur lors du chargement des factures');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-8 w-8" />
            Factures
          </h1>
          <p className="text-muted-foreground mt-1">Historique complet des factures</p>
        </div>
        <Link to="/factures/nouvelle">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Nouvelle Facture
          </Button>
        </Link>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par numéro de facture ou client..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tous les statuts</option>
              <option value="payee">Payée</option>
              <option value="partielle">Partielle</option>
              <option value="en_attente">En attente</option>
              <option value="annulee">Annulée</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tableau */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Liste des Factures</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Facture</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="flex items-center gap-1">
                  Payé
                  <span title="Allocation FIFO: les paiements remboursent les factures les plus anciennes en premier">
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </span>
                </TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factures.map((facture) => {
                  const total = parseFloat(facture.total as any) || 0;
                  const montantPaye = parseFloat(facture.montant_paye as any) || 0;
                  const remainingDue = parseFloat(facture.remaining_due as any) || total;
                  return (
                    <TableRow key={facture.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/factures/${facture.id}`)}>
                      <TableCell className="font-mono font-semibold">{facture.numero_facture}</TableCell>
                      <TableCell>{facture.client_nom} {facture.client_prenom}</TableCell>
                      <TableCell>{new Date(facture.date_facture).toLocaleDateString('fr-FR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}</TableCell>
                      <TableCell className="text-right">{formatXOF(facture.total)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className={`text-sm font-semibold ${montantPaye >= total ? 'text-success' : 'text-warning'}`}>
                            {formatXOF(montantPaye)}
                          </span>
                          {facture.statut === 'partielle' && (
                            <span className="text-xs text-muted-foreground">
                              Reste: {formatXOF(remainingDue)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge type="facture" statut={facture.statut} /></TableCell>
                    </TableRow>
                  );
                })}
                {factures?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">Aucune facture trouvée</p>
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
    </div>
  );
}
