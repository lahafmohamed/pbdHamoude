import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { factureService } from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Download, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatFCFA as formatXOF } from '../utils/format';

const COLORS = ['#1E3A8A', '#1D4ED8', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE'];
const CHART_PRIMARY = '#1D4ED8';

export default function ClientAnalytics() {
  const [topClients, setTopClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const topClientsData = await factureService.getTopClients(10);

      setTopClients(topClientsData.map((c: any) => ({
        ...c,
        total_depenses: parseFloat(c.total_depenses) || 0,
        nombre_factures: parseInt(c.nombre_factures) || 0,
      })));
    } catch (error) {
      toast.error('Erreur lors du chargement');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Nom', 'Prénom', 'Email', 'Téléphone', 'NIF', 'Total Dépenses', 'Nb Factures'];
    const rows = topClients.map(c => [
      c.nom,
      c.prenom || '',
      c.email || '',
      c.telephone || '',
      c.nif || '',
      c.total_depenses.toFixed(2),
      c.nombre_factures,
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'top-clients.csv';
    a.click();
    toast.success('Export CSV réussi');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const totalRevenue = topClients.reduce((sum, c) => sum + c.total_depenses, 0);
  const avgPerClient = topClients.length > 0 ? totalRevenue / topClients.length : 0;

  const pieData = topClients.slice(0, 7).map(c => ({
    name: `${c.nom} ${c.prenom || ''}`.trim(),
    value: c.total_depenses,
  }));

  return (
    <div className="p-3 sm:p-6 w-full">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-8 w-8" />
            Analytics Clients
          </h1>
          <p className="text-muted-foreground mt-1">Analyse détaillée de votre clientèle</p>
        </div>
        <div className="flex gap-2">
          <Link to="/tiers">
            <Button variant="outline" className="gap-2">
              <Users className="h-4 w-4" />
              Gérer les Contacts
            </Button>
          </Link>
          <Button onClick={exportToCSV} className="gap-2">
            <Download className="h-4 w-4" />
            Exporter CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{topClients.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Meilleurs clients affichés</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Chiffre d'Affaires Clients</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatXOF(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground mt-1">Total des ventes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Moyenne par Client</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatXOF(avgPerClient)}</div>
            <p className="text-xs text-muted-foreground mt-1">Panier moyen</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Clients Chart */}
      {topClients.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Top 10 Clients par Montant Dépensé
              </CardTitle>
              <CardDescription>Classement des meilleurs clients</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topClients}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="nom" tick={{ fontSize: 11 }} tickFormatter={(value) => `${value.substring(0, 12)}...`} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: any) => formatXOF(value)} />
                  <Bar dataKey="total_depenses" fill={CHART_PRIMARY} name="Montant dépensé" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Répartition du Chiffre d'Affaires</CardTitle>
                <CardDescription>Top 7 clients</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${String(name).substring(0, 15)} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                      outerRadius={80}
                      fill={CHART_PRIMARY}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => formatXOF(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardHeader>
                <CardTitle>Classement Détaillé</CardTitle>
                <CardDescription>Top clients avec statistiques</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Factures</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topClients.map((client, index) => (
                      <TableRow key={client.nom + client.prenom}>
                        <TableCell className="font-bold">{index + 1}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-semibold">{client.nom} {client.prenom}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{client.nombre_factures}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold">{formatXOF(client.total_depenses)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
