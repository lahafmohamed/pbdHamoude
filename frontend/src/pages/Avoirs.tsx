import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import {
  FilePlus,
  Search,
  Eye,
  Loader2,
  Download,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Wallet,
  CheckCircle2,
  FileEdit,
  Hourglass,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { formatXOF, fuzzyScore } from '@/utils/format';
import { creditNoteService } from '@/services/api';
import { toast } from 'sonner';

interface Avoir {
  id: number;
  numero_avoir: string;
  tiers_id: number;
  client_id?: number;
  client_nom: string;
  client_prenom?: string | null;
  date_avoir: string;
  statut: 'brouillon' | 'valide' | 'utilise' | 'annule' | string;
  total: number;
  avoir_type: string | null;
  notes: string | null;
  facture_origine_id?: number;
  facture_origine_numero?: string | null;
}

type SortKey = 'numero_avoir' | 'client_nom' | 'date_avoir' | 'total';
type SortOrder = 'asc' | 'desc';

const TYPE_LABEL: Record<string, string> = {
  erreur: 'Erreur facturation',
  retour: 'Retour marchandise',
  remise: 'Remise commerciale',
};

const TYPE_BADGE: Record<string, string> = {
  erreur: 'bg-warning-100 text-warning-800',
  retour: 'bg-info-100 text-info-700',
  remise: 'bg-success-100 text-success-700',
};

const STATUT_TABS: Array<{ id: string; label: string }> = [
  { id: 'tous', label: 'Tous' },
  { id: 'brouillon', label: 'Brouillon' },
  { id: 'valide', label: 'Validés' },
  { id: 'utilise', label: 'Utilisés' },
  { id: 'annule', label: 'Annulés' },
];

const PAGE_LIMIT = 20;

export default function Avoirs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [avoirs, setAvoirs] = useState<Avoir[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const search = searchParams.get('q') || '';
  const statutFilter = searchParams.get('statut') || 'tous';
  const typeFilter = searchParams.get('type') || 'tous';
  const sortKey = (searchParams.get('sort') as SortKey) || 'date_avoir';
  const sortOrder = (searchParams.get('order') as SortOrder) || 'desc';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'tous' || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  useEffect(() => {
    loadAvoirs();
  }, []);

  const loadAvoirs = async () => {
    try {
      setLoading(true);
      const data = await creditNoteService.getAll();
      setAvoirs(data);
    } catch {
      toast.error("Erreur lors du chargement des avoirs");
    } finally {
      setLoading(false);
    }
  };

  // KPI tiles
  const kpi = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let brouillonCount = 0;
    let brouillonTotal = 0;
    let valideCount = 0;
    let valideTotal = 0;
    let utiliseMoisCount = 0;
    let utiliseMoisTotal = 0;
    let moisCount = 0;
    let moisTotal = 0;

    for (const a of avoirs) {
      const total = Number(a.total) || 0;
      const date = new Date(a.date_avoir);
      const inMonth = date >= startOfMonth;
      if (inMonth) {
        moisCount++;
        moisTotal += total;
      }
      if (a.statut === 'brouillon') {
        brouillonCount++;
        brouillonTotal += total;
      } else if (a.statut === 'valide') {
        valideCount++;
        valideTotal += total;
      } else if (a.statut === 'utilise' && inMonth) {
        utiliseMoisCount++;
        utiliseMoisTotal += total;
      }
    }

    return {
      brouillonCount,
      brouillonTotal,
      valideCount,
      valideTotal,
      utiliseMoisCount,
      utiliseMoisTotal,
      moisCount,
      moisTotal,
    };
  }, [avoirs]);

  // Filter + search + sort
  const processed = useMemo(() => {
    let rows = avoirs;
    if (statutFilter !== 'tous') {
      rows = rows.filter((a) => a.statut === statutFilter);
    }
    if (typeFilter !== 'tous') {
      rows = rows.filter((a) => (a.avoir_type || '') === typeFilter);
    }
    if (search.trim()) {
      rows = rows
        .map((a) => ({
          a,
          score: Math.max(
            fuzzyScore(search, a.numero_avoir),
            fuzzyScore(search, a.client_nom),
            fuzzyScore(search, a.facture_origine_numero || ''),
          ),
        }))
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score)
        .map((r) => r.a);
    } else {
      const dir = sortOrder === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = (a as any)[sortKey];
        const bv = (b as any)[sortKey];
        if (sortKey === 'total') {
          return (Number(av) - Number(bv)) * dir;
        }
        if (sortKey === 'date_avoir') {
          return (new Date(av).getTime() - new Date(bv).getTime()) * dir;
        }
        return String(av || '').localeCompare(String(bv || ''), 'fr') * dir;
      });
    }
    return rows;
  }, [avoirs, statutFilter, typeFilter, search, sortKey, sortOrder]);

  const totalSum = useMemo(
    () => processed.reduce((sum, a) => sum + (Number(a.total) || 0), 0),
    [processed]
  );

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_LIMIT));
  const paged = processed.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);

  const toggleSort = (key: SortKey) => {
    if (search.trim()) return; // sort disabled while fuzzy ranking active
    if (sortKey !== key) {
      const next = new URLSearchParams(searchParams);
      next.set('sort', key);
      next.set('order', 'desc');
      setSearchParams(next, { replace: true });
    } else {
      const next = new URLSearchParams(searchParams);
      next.set('order', sortOrder === 'asc' ? 'desc' : 'asc');
      setSearchParams(next, { replace: true });
    }
  };

  const sortIcon = (key: SortKey) => {
    if (search.trim()) return null;
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const exportCSV = () => {
    const header = ['Numéro', 'Client', 'Date', 'Type', 'Statut', 'Facture origine', 'Montant'];
    const rows = processed.map((a) => [
      a.numero_avoir,
      `${a.client_nom}${a.client_prenom ? ' ' + a.client_prenom : ''}`,
      new Date(a.date_avoir).toLocaleDateString('fr-FR'),
      TYPE_LABEL[a.avoir_type || ''] || a.avoir_type || '',
      a.statut,
      a.facture_origine_numero || '',
      String(a.total || 0),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `avoirs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderType = (type: string | null) => {
    if (!type) return <span className="text-muted-foreground">—</span>;
    const cls = TYPE_BADGE[type] || 'bg-muted text-muted-foreground';
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
        {TYPE_LABEL[type] || type}
      </span>
    );
  };

  const formatClient = (a: Avoir) =>
    a.client_prenom ? `${a.client_nom} ${a.client_prenom}` : a.client_nom;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Avoirs</h1>
          <p className="text-sm text-muted-foreground">
            Notes de crédit clients — retours, erreurs et remises commerciales
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} disabled={loading || processed.length === 0} className="gap-1.5">
            <Download className="h-4 w-4" />
            Exporter CSV
          </Button>
          <Button onClick={() => navigate('/avoirs/nouveau')} className="gap-1.5">
            <FilePlus className="h-4 w-4" />
            Nouvel avoir
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          icon={<Wallet className="h-4 w-4" />}
          label="Validés non utilisés"
          value={formatXOF(kpi.valideTotal)}
          sub={`${kpi.valideCount} avoirs`}
          tone="warning"
        />
        <KpiTile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Utilisés ce mois"
          value={formatXOF(kpi.utiliseMoisTotal)}
          sub={`${kpi.utiliseMoisCount} avoirs`}
          tone="success"
        />
        <KpiTile
          icon={<FileEdit className="h-4 w-4" />}
          label="Brouillons"
          value={`${kpi.brouillonCount}`}
          sub={kpi.brouillonTotal > 0 ? formatXOF(kpi.brouillonTotal) : '—'}
          tone="muted"
        />
        <KpiTile
          icon={<Hourglass className="h-4 w-4" />}
          label="Total ce mois"
          value={formatXOF(kpi.moisTotal)}
          sub={`${kpi.moisCount} avoirs`}
          tone="primary"
        />
      </div>

      <Card>
        {/* Tabs + filters */}
        <div className="border-b">
          <div className="flex items-center gap-2 p-2 overflow-x-auto">
            {STATUT_TABS.map((tab) => {
              const active = statutFilter === tab.id;
              const count =
                tab.id === 'tous'
                  ? avoirs.length
                  : avoirs.filter((a) => a.statut === tab.id).length;
              return (
                <button
                  key={tab.id}
                  onClick={() => setParam('statut', tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium num ${
                      active ? 'bg-primary-foreground/20' : 'bg-muted'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par numéro, client ou facture"
              value={search}
              onChange={(e) => setParam('q', e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setParam('type', e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="tous">Tous les types</option>
            <option value="erreur">Erreur facturation</option>
            <option value="retour">Retour marchandise</option>
            <option value="remise">Remise commerciale</option>
          </select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Numéro" onClick={() => toggleSort('numero_avoir')} icon={sortIcon('numero_avoir')} />
              <SortableHead label="Client" onClick={() => toggleSort('client_nom')} icon={sortIcon('client_nom')} />
              <SortableHead label="Date" onClick={() => toggleSort('date_avoir')} icon={sortIcon('date_avoir')} />
              <TableHead>Type</TableHead>
              <TableHead>Facture origine</TableHead>
              <TableHead>Statut</TableHead>
              <SortableHead label="Montant" onClick={() => toggleSort('total')} icon={sortIcon('total')} align="right" />
              <TableHead className="text-right w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground inline" />
                </TableCell>
              </TableRow>
            ) : processed.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  {search.trim() || statutFilter !== 'tous' || typeFilter !== 'tous' ? (
                    <div className="text-muted-foreground text-sm">
                      Aucun avoir ne correspond aux filtres
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <FilePlus className="h-10 w-10 opacity-40" />
                      <div className="text-sm">Aucun avoir enregistré</div>
                      <Button size="sm" onClick={() => navigate('/avoirs/nouveau')}>
                        Créer le premier avoir
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paged.map((avoir) => (
                  <TableRow
                    key={avoir.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/avoirs/${avoir.id}`)}
                  >
                    <TableCell className="font-medium num">{avoir.numero_avoir}</TableCell>
                    <TableCell>
                      {avoir.client_id ? (
                        <Link
                          to={`/tiers/${avoir.client_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {formatClient(avoir)}
                        </Link>
                      ) : (
                        formatClient(avoir)
                      )}
                    </TableCell>
                    <TableCell className="num">
                      {new Date(avoir.date_avoir).toLocaleDateString('fr-FR')}
                    </TableCell>
                    <TableCell>{renderType(avoir.avoir_type)}</TableCell>
                    <TableCell>
                      {avoir.facture_origine_numero && avoir.facture_origine_id ? (
                        <Link
                          to={`/factures/${avoir.facture_origine_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="num text-primary hover:underline"
                        >
                          {avoir.facture_origine_numero}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge type="avoir" statut={avoir.statut} />
                    </TableCell>
                    <TableCell className="text-right font-medium num">
                      {formatXOF(avoir.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/avoirs/${avoir.id}`);
                        }}
                        aria-label="Voir l'avoir"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-semibold border-t-2">
                  <TableCell colSpan={6} className="text-right text-muted-foreground">
                    Total ({processed.length} avoir{processed.length > 1 ? 's' : ''})
                  </TableCell>
                  <TableCell className="text-right num">{formatXOF(totalSum)}</TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>

        {!loading && processed.length > PAGE_LIMIT && (
          <div className="border-t">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={processed.length}
              limit={PAGE_LIMIT}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'warning' | 'success' | 'muted' | 'primary';
}) {
  const toneCls: Record<typeof tone, string> = {
    warning: 'text-warning-700',
    success: 'text-success-700',
    muted: 'text-muted-foreground',
    primary: 'text-primary',
  };
  return (
    <Card className="p-4">
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${toneCls[tone]}`}>
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold num">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground num">{sub}</div>
    </Card>
  );
}

function SortableHead({
  label,
  onClick,
  icon,
  align,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  align?: 'right';
}) {
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          align === 'right' ? 'ml-auto' : ''
        }`}
      >
        {label}
        {icon}
      </button>
    </TableHead>
  );
}
