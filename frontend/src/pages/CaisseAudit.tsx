import { useEffect, useState } from 'react';
import { caisseService } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, RefreshCw, Filter } from 'lucide-react';
import { formatFCFA } from '@/lib/utils';
import { toast } from 'sonner';

const SOURCE_KINDS = [
  { value: '', label: 'Tous' },
  { value: 'paiement', label: 'Paiements' },
  { value: 'acompte_client', label: 'Acomptes client' },
  { value: 'acompte_fournisseur', label: 'Acomptes fournisseur' },
];

const KIND_BADGE: Record<string, string> = {
  paiement: 'bg-green-50 text-green-700',
  acompte_client: 'bg-blue-50 text-blue-700',
  acompte_fournisseur: 'bg-orange-50 text-orange-700',
};

export default function CaisseAudit() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [orphansTotal, setOrphansTotal] = useState(0);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [sourceKind, setSourceKind] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await caisseService.getAudit({
        orphans_only: orphansOnly,
        source_kind: sourceKind || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 500,
      });
      setItems(r.data || []);
      setSummary(r.summary || []);
      setOrphansTotal(r.orphans_total || 0);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Erreur audit');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orphansOnly, sourceKind, dateFrom, dateTo]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Caisse</h1>
        <Button onClick={load} variant="outline" size="sm" className="gap-1">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className={orphansTotal > 0 ? 'border-red-500 border-2' : 'border-green-500 border-2'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {orphansTotal > 0
                ? <AlertTriangle className="h-5 w-5 text-red-600" />
                : <CheckCircle2 className="h-5 w-5 text-green-600" />}
              <div>
                <p className="text-xs text-muted-foreground">Orphelins (espèce sans caisse)</p>
                <p className={`text-2xl font-bold ${orphansTotal > 0 ? 'text-red-600' : 'text-green-600'}`}>{orphansTotal}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {summary.map((s: any) => (
          <Card key={s.source_kind}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground capitalize">{s.source_kind.replace('_', ' ')}</p>
              <p className="text-xl font-bold">{s.total}</p>
              <p className="text-xs text-muted-foreground">{formatFCFA(s.total_montant)}</p>
              {parseInt(s.orphans) > 0 && (
                <Badge variant="destructive" className="text-xs mt-1">{s.orphans} orphelins</Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" /> Filtres</CardTitle>
        </CardHeader>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs">Type</Label>
            <select value={sourceKind} onChange={e => setSourceKind(e.target.value)} className="block border rounded-md px-3 py-2 text-sm bg-background">
              {SOURCE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Du</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm w-40" />
          </div>
          <div>
            <Label className="text-xs">Au</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm w-40" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={orphansOnly} onChange={e => setOrphansOnly(e.target.checked)} />
            Orphelins uniquement
          </label>
          {(dateFrom || dateTo || sourceKind || orphansOnly) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setSourceKind(''); setOrphansOnly(false); }}>
              Réinitialiser
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Mouvements ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Chargement...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Aucun mouvement.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Tiers</TableHead>
                  <TableHead className="text-xs">Méthode</TableHead>
                  <TableHead className="text-xs text-right">Montant</TableHead>
                  <TableHead className="text-xs">Session</TableHead>
                  <TableHead className="text-xs">Mvt caisse</TableHead>
                  <TableHead className="text-xs">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it: any) => (
                  <TableRow key={`${it.source_kind}-${it.source_id}`} className={it.is_orphan ? 'bg-red-50' : ''}>
                    <TableCell className="text-xs whitespace-nowrap">{(it.source_date || '').substring(0, 10)}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${KIND_BADGE[it.source_kind] || ''}`}>
                        {it.source_kind}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono">#{it.source_id}</TableCell>
                    <TableCell className="text-xs">{it.tiers_id || '—'}</TableCell>
                    <TableCell className="text-xs">{it.methode_paiement}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{formatFCFA(it.montant)}</TableCell>
                    <TableCell className="text-xs">{it.session_caisse_id || '—'}</TableCell>
                    <TableCell className="text-xs">{it.mouvement_caisse_id || '—'}</TableCell>
                    <TableCell>
                      {it.is_orphan
                        ? <Badge variant="destructive" className="text-xs">Orphelin</Badge>
                        : <Badge variant="outline" className="text-xs">OK</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
