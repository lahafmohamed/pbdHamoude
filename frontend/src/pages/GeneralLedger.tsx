import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { generalLedgerService } from '../services/api';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Compte {
  id: number;
  numero: string;
  intitule: string;
  type_compte: string;
  categorie: string | null;
  actif: boolean;
}

interface EcritureComptable {
  id: number;
  numero_piece: string | null;
  date_ecriture: string;
  journal: string;
  piece_id: number | null;
  piece_type: string | null;
  ligne_numero: number;
  compte_id: number;
  compte_numero: string;
  compte_intitule: string;
  debit: string;
  credit: string;
  description: string | null;
}

interface BalanceComptable {
  compte_id: number;
  compte_numero: string;
  compte_intitule: string;
  total_debit: string;
  total_credit: string;
  solde: string;
}

const SELECT_CLS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const BADGE_BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const JOURNAL_BADGE: Record<string, string> = {
  ACHATS: 'bg-danger-100 text-danger-700',
  VENTES: 'bg-success-100 text-success-700',
  TRESORERIE: 'bg-info-100 text-info-700',
  OD: 'bg-warning-100 text-warning-800',
};

const TYPE_BADGE: Record<string, string> = {
  actif: 'bg-info-100 text-info-700',
  passif: 'bg-warning-100 text-warning-800',
  capitaux_propres: 'bg-success-100 text-success-700',
  charge: 'bg-danger-100 text-danger-700',
  produit: 'bg-primary-100 text-primary-700',
};

const formatNum = (s: string) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(parseFloat(s) || 0));

const TABLE_HEAD = 'px-3 py-2 font-medium';
const NUM_CELL = 'px-3 py-2 text-right num';

export default function GeneralLedger() {
  const [ecritures, setEcritures] = useState<EcritureComptable[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<Compte[]>([]);
  const [trialBalance, setTrialBalance] = useState<BalanceComptable[]>([]);
  const [activeTab, setActiveTab] = useState<'ecritures' | 'chart' | 'trial-balance'>('ecritures');
  const [loading, setLoading] = useState(true);
  const [filterJournal, setFilterJournal] = useState<string>('');
  const [dateDebut, setDateDebut] = useState<string>(new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]);
  const [dateFin, setDateFin] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (activeTab === 'ecritures') {
      fetchEcritures();
    } else if (activeTab === 'chart') {
      fetchChartOfAccounts();
    } else if (activeTab === 'trial-balance') {
      fetchTrialBalance();
    }
  }, [activeTab, filterJournal, dateDebut, dateFin]);

  const fetchEcritures = async () => {
    try {
      const data = await generalLedgerService.getAll(filterJournal, dateDebut, dateFin);
      setEcritures(data.data || data);
    } catch {
      toast.error('Erreur chargement écritures');
    } finally {
      setLoading(false);
    }
  };

  const fetchChartOfAccounts = async () => {
    try {
      const data = await generalLedgerService.getChartOfAccounts();
      setChartOfAccounts(data.data || data);
    } catch {
      toast.error('Erreur chargement plan comptable');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrialBalance = async () => {
    try {
      const data = await generalLedgerService.getTrialBalance(dateDebut, dateFin);
      setTrialBalance(data.data || data);
    } catch {
      toast.error('Erreur chargement balance comptable');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Grand livre comptable</h1>
      </div>

      <div className="mb-6 inline-flex rounded-md border bg-card p-1">
        {[
          { id: 'ecritures', label: 'Écritures' },
          { id: 'chart', label: 'Plan comptable' },
          { id: 'trial-balance', label: 'Balance' },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border bg-card shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="gl-debut">Date début</Label>
            <Input id="gl-debut" type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-fin">Date fin</Label>
            <Input id="gl-fin" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
          </div>
          {activeTab === 'ecritures' && (
            <div className="space-y-1.5">
              <Label htmlFor="gl-journal">Journal</Label>
              <select
                id="gl-journal"
                className={SELECT_CLS}
                value={filterJournal}
                onChange={(e) => setFilterJournal(e.target.value)}
              >
                <option value="">Tous les journaux</option>
                <option value="ACHATS">ACHATS</option>
                <option value="VENTES">VENTES</option>
                <option value="TRESORERIE">TRESORERIE</option>
                <option value="OD">OD (Opérations diverses)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'ecritures' && (
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Écritures comptables</h2>
            {ecritures.length === 0 ? (
              <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">
                Aucune écriture pour la période sélectionnée
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className={TABLE_HEAD}>N° pièce</th>
                      <th className={TABLE_HEAD}>Date</th>
                      <th className={TABLE_HEAD}>Journal</th>
                      <th className={TABLE_HEAD}>Compte</th>
                      <th className={TABLE_HEAD}>Description</th>
                      <th className={TABLE_HEAD + ' text-right'}>Débit</th>
                      <th className={TABLE_HEAD + ' text-right'}>Crédit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {ecritures.map((ecriture) => (
                      <tr key={ecriture.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium text-xs num">{ecriture.numero_piece}</td>
                        <td className="px-3 py-2 text-xs num">{new Date(ecriture.date_ecriture).toLocaleDateString('fr-FR')}</td>
                        <td className="px-3 py-2">
                          <span className={`${BADGE_BASE} ${JOURNAL_BADGE[ecriture.journal] || 'bg-muted text-muted-foreground'}`}>
                            {ecriture.journal}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{ecriture.compte_numero} — {ecriture.compte_intitule}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{ecriture.description || '—'}</td>
                        <td className={NUM_CELL + ' font-medium'}>{formatNum(ecriture.debit)}</td>
                        <td className={NUM_CELL + ' font-medium'}>{formatNum(ecriture.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'chart' && (
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Plan comptable</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className={TABLE_HEAD}>N°</th>
                    <th className={TABLE_HEAD}>Intitulé</th>
                    <th className={TABLE_HEAD}>Type</th>
                    <th className={TABLE_HEAD}>Catégorie</th>
                    <th className={TABLE_HEAD}>Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {chartOfAccounts.map((compte) => (
                    <tr key={compte.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium num">{compte.numero}</td>
                      <td className="px-3 py-2">{compte.intitule}</td>
                      <td className="px-3 py-2">
                        <span className={`${BADGE_BASE} ${TYPE_BADGE[compte.type_compte] || 'bg-muted text-muted-foreground'}`}>
                          {compte.type_compte}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{compte.categorie || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`${BADGE_BASE} ${
                          compte.actif ? 'bg-success-100 text-success-700' : 'bg-muted text-muted-foreground'
                        }`}>
                          {compte.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'trial-balance' && (
        <div className="rounded-md border bg-card shadow-sm">
          <div className="p-5">
            <h2 className="text-lg font-semibold mb-3">Balance comptable</h2>
            {trialBalance.length === 0 ? (
              <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">
                Aucune donnée pour la période sélectionnée
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className={TABLE_HEAD}>N°</th>
                      <th className={TABLE_HEAD}>Compte</th>
                      <th className={TABLE_HEAD + ' text-right'}>Total débit</th>
                      <th className={TABLE_HEAD + ' text-right'}>Total crédit</th>
                      <th className={TABLE_HEAD + ' text-right'}>Solde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {trialBalance.map((balance) => (
                      <tr key={balance.compte_id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium num">{balance.compte_numero}</td>
                        <td className="px-3 py-2">{balance.compte_intitule}</td>
                        <td className={NUM_CELL + ' font-medium'}>{formatNum(balance.total_debit)}</td>
                        <td className={NUM_CELL + ' font-medium'}>{formatNum(balance.total_credit)}</td>
                        <td className={`${NUM_CELL} font-semibold ${
                          parseFloat(balance.solde) >= 0 ? 'text-success-700' : 'text-danger-700'
                        }`}>
                          {formatNum(balance.solde)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
