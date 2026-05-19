import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../services/authService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';
import { formatFCFA } from '../utils/format';

const TABLE_HEAD = 'px-3 py-2 font-medium';

export default function Reporting() {
  const [kpis, setKpis] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [salesByCategory, setSalesByCategory] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const [dateDebut, setDateDebut] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]);
  const [dateFin, setDateFin] = useState(today.toISOString().split('T')[0]);

  useEffect(() => {
    fetchAllData();
  }, [dateDebut, dateFin]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [kpisRes, pnlRes, catRes, prodRes, recvRes] = await Promise.all([
        api.get('/reports/dashboard'),
        api.get(`/reports/pnl?date_debut=${dateDebut}&date_fin=${dateFin}`),
        api.get(`/reports/sales-by-category?date_debut=${dateDebut}&date_fin=${dateFin}`),
        api.get(`/reports/products?date_debut=${dateDebut}&date_fin=${dateFin}&limit=10`),
        api.get('/reports/receivables'),
      ]);

      setKpis(kpisRes.data.data);
      setPnl(pnlRes.data.data);
      setSalesByCategory(catRes.data.data);
      setTopProducts(prodRes.data.data);
      setReceivables(recvRes.data.data);
    } catch {
      toast.error('Erreur chargement données');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const COLORS = ['#1E3A8A', '#1D4ED8', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE'];
  const CHART_PRIMARY = '#1D4ED8';

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Rapports et analyses</h1>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-8 w-auto" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-8 w-auto" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Chiffre d'affaires (mois)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold num">{formatFCFA(kpis?.revenue_mois?.total || 0)}</div>
            <p className="text-xs text-muted-foreground">{kpis?.revenue_mois?.count || 0} factures</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Créances clients</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold num">{formatFCFA(kpis?.creances?.total || 0)}</div>
            <p className="text-xs text-muted-foreground">{kpis?.creances?.count || 0} factures impayées</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Valeur du stock</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold num">{formatFCFA(kpis?.valeur_stock?.valeur || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Alertes stock</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-danger-700 num">{kpis?.alertes_stock || 0}</div>
            <p className="text-xs text-muted-foreground">produits sous le minimum</p>
          </CardContent>
        </Card>
      </div>

      {pnl && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Compte de résultat</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Chiffre d'affaires</p>
                <p className="text-xl font-semibold text-success-700 num">{formatFCFA(pnl.chiffre_affaires)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Coût des ventes</p>
                <p className="text-xl font-semibold text-danger-700 num">{formatFCFA(pnl.cout_ventes)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Marge brute</p>
                <p className="text-xl font-semibold num">{formatFCFA(pnl.marge_brute)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Marge %</p>
                <p className="text-xl font-semibold num">{pnl.marge_pourcentage}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader><CardTitle>Ventes par catégorie</CardTitle></CardHeader>
          <CardContent>
            {salesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={salesByCategory.map((c) => ({ name: c.categorie, value: parseFloat(c.chiffre_affaires) }))}
                    cx="50%" cy="50%" outerRadius={80} fill={CHART_PRIMARY}
                    dataKey="value" label
                  >
                    {salesByCategory.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8 text-sm">Aucune donnée</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top 10 produits par marge</CardTitle></CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProducts.map((p) => ({ nom: p.nom.substring(0, 20), marge: parseFloat(p.marge_brute) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="nom" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="marge" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8 text-sm">Aucune donnée</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Créances clients (aging)</CardTitle></CardHeader>
        <CardContent>
          {receivables.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className={TABLE_HEAD}>Client</th>
                    <th className={TABLE_HEAD + ' text-right'}>Total dû</th>
                    <th className={TABLE_HEAD + ' text-right'}>&lt; 30 jours</th>
                    <th className={TABLE_HEAD + ' text-right'}>30-60 jours</th>
                    <th className={TABLE_HEAD + ' text-right'}>&gt; 60 jours</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {receivables.map((client) => (
                    <tr key={client.client_id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{client.nom} {client.prenom}</td>
                      <td className="px-3 py-2 text-right font-semibold text-danger-700 num">{formatFCFA(client.total_du)}</td>
                      <td className="px-3 py-2 text-right text-success-700 num">{formatFCFA(client.moins_30_jours)}</td>
                      <td className="px-3 py-2 text-right text-warning-700 num">{formatFCFA(client.entre_30_60_jours)}</td>
                      <td className="px-3 py-2 text-right text-danger-700 num">{formatFCFA(client.plus_60_jours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8 text-sm">Aucune créance</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
