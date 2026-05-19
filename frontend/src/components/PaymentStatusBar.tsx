import React from 'react';
import { CheckCircle2, CircleDashed, XCircle, Circle, Plus, type LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
import { formatFCFA } from '../utils/format';

interface PaymentStatusBarProps {
  montantPaye: number;
  remainingDue: number;
  total: number;
  statut: 'payee' | 'partielle' | 'en_attente' | 'annulee';
  onAddPayment?: () => void;
}

type StatusConfig = {
  textColor: string;
  barColor: string;
  label: string;
  Icon: LucideIcon;
};

export const PaymentStatusBar: React.FC<PaymentStatusBarProps> = ({
  montantPaye,
  remainingDue,
  total,
  statut,
  onAddPayment,
}) => {
  const montantPayeNum = parseFloat(montantPaye as any) || 0;
  const remainingDueNum = parseFloat(remainingDue as any) || 0;
  const totalNum = parseFloat(total as any) || 0;

  const percentage = totalNum > 0 ? (montantPayeNum / totalNum) * 100 : 0;

  const getStatusConfig = (): StatusConfig => {
    switch (statut) {
      case 'payee':
        return { textColor: 'text-success-700', barColor: 'bg-success-500', label: 'Payée', Icon: CheckCircle2 };
      case 'partielle':
        return { textColor: 'text-warning-700', barColor: 'bg-warning-500', label: 'Partielle', Icon: CircleDashed };
      case 'annulee':
        return { textColor: 'text-danger-700', barColor: 'bg-danger-500', label: 'Annulée', Icon: XCircle };
      default:
        return { textColor: 'text-danger-700', barColor: 'bg-danger-500', label: 'Non payée', Icon: Circle };
    }
  };

  const cfg = getStatusConfig();
  const StatusIcon = cfg.Icon;

  if (statut === 'annulee') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
        <StatusIcon className="h-5 w-5 shrink-0" />
        <span className="font-semibold">Facture {cfg.label}</span>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-md border bg-card shadow-sm">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-5 w-5 ${cfg.textColor}`} />
            <span className={`font-semibold text-base ${cfg.textColor}`}>
              Statut: {cfg.label}
            </span>
          </div>
          {onAddPayment && statut !== 'payee' && (
            <Button size="sm" onClick={onAddPayment} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Enregistrer un paiement
            </Button>
          )}
        </div>

        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Progression du paiement</span>
            <span className="font-medium num">{percentage.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${cfg.barColor}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold text-base num">{formatFCFA(totalNum)}</div>
          </div>
          <div>
            <div className="text-xs text-success-700">Payé</div>
            <div className="font-semibold text-base text-success-700 num">{formatFCFA(montantPayeNum)}</div>
          </div>
          <div>
            <div className="text-xs text-danger-700">Reste dû</div>
            <div className="font-semibold text-base text-danger-700 num">{formatFCFA(remainingDueNum)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
