import React from 'react';
import { X } from 'lucide-react';
import { Paiement, METHODES_PAIEMENT, FALLBACK_PAIEMENT_ICON } from '../types';
import { Button } from './ui/button';
import { formatFCFA } from '../utils/format';

interface PaymentHistoryProps {
  paiements: Paiement[];
  onDelete?: (id: number) => void;
}

const SOURCE_BADGE: Record<string, string> = {
  acompte_application: 'bg-info-100 text-info-700',
  reversal: 'bg-warning-100 text-warning-800',
  direct: 'bg-muted text-muted-foreground',
};

const SOURCE_LABEL: Record<string, string> = {
  acompte_application: 'Acompte',
  reversal: 'Annulation',
};

export const PaymentHistory: React.FC<PaymentHistoryProps> = ({ paiements, onDelete }) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getMethodeConfig = (methode: string) => {
    return METHODES_PAIEMENT[methode as keyof typeof METHODES_PAIEMENT] || {
      label: methode,
      color: 'bg-gray-500',
      Icon: FALLBACK_PAIEMENT_ICON,
    };
  };

  if (!paiements || paiements.length === 0) {
    return (
      <div className="rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-700">
        Aucun paiement enregistré pour cette facture
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Méthode</th>
            <th className="px-3 py-2 font-medium text-right">Montant</th>
            <th className="px-3 py-2 font-medium">Référence</th>
            <th className="px-3 py-2 font-medium">Notes</th>
            {onDelete && <th className="px-3 py-2 font-medium w-20">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {paiements.map((paiement) => {
            const methodeConfig = getMethodeConfig(paiement.methode_paiement);
            const MethodIcon = methodeConfig.Icon;
            const montant = parseFloat(paiement.montant as any) || 0;
            const sourceKey = paiement.source === 'acompte_application' || paiement.source === 'reversal'
              ? paiement.source
              : 'direct';
            const sourceLabel = SOURCE_LABEL[sourceKey] ?? 'Direct';

            return (
              <tr key={paiement.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">{formatDate(paiement.date_paiement)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_BADGE[sourceKey]}`}>
                    {sourceLabel}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <MethodIcon className="h-4 w-4 text-muted-foreground" />
                    <span>{methodeConfig.label}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-medium text-success-700 num">
                  {formatFCFA(montant)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {paiement.reference || '—'}
                </td>
                <td className="px-3 py-2 max-w-xs truncate text-muted-foreground">
                  {paiement.notes || '—'}
                </td>
                {onDelete && paiement.source !== 'acompte_application' && (
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                      onClick={() => onDelete?.(paiement.id)}
                      aria-label="Supprimer ce paiement"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
