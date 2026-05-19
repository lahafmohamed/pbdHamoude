import { Badge } from '@/components/ui/badge';
import { CheckCircle, Clock, XCircle } from 'lucide-react';

type DocumentType = 'facture' | 'devis' | 'bl' | 'avoir';

const STATUS_CONFIG: Record<DocumentType, Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'; icon?: React.ReactNode }>> = {
  facture: {
    payee: { label: 'Payée', variant: 'success', icon: <CheckCircle className="h-3 w-3" /> },
    partielle: { label: 'Partiellement payée', variant: 'warning', icon: <Clock className="h-3 w-3" /> },
    en_attente: { label: 'En attente', variant: 'warning', icon: <Clock className="h-3 w-3" /> },
    annulee: { label: 'Annulée', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  },
  devis: {
    brouillon: { label: 'Brouillon', variant: 'secondary' },
    envoye: { label: 'En attente', variant: 'warning' },
    accepte: { label: 'Confirmé', variant: 'success' },
    refuse: { label: 'Refusé', variant: 'destructive' },
    annule: { label: 'Annulé', variant: 'destructive' },
    converti: { label: 'Facturé', variant: 'success' },
  },
  bl: {
    brouillon: { label: 'En attente', variant: 'warning' },
    valide: { label: 'En attente', variant: 'warning' },
    livre: { label: 'Livré', variant: 'success' },
    facture: { label: 'Facturé', variant: 'success' },
    annule: { label: 'Annulé', variant: 'destructive' },
  },
  avoir: {
    brouillon: { label: 'Brouillon', variant: 'secondary' },
    en_attente: { label: 'En attente', variant: 'warning' },
    valide: { label: 'Validé', variant: 'success' },
    utilise: { label: 'Utilisé', variant: 'default' },
    annule: { label: 'Annulé', variant: 'destructive' },
  },
};

interface StatusBadgeProps {
  type: DocumentType;
  statut: string;
  className?: string;
}

export default function StatusBadge({ type, statut, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[type]?.[statut];
  if (!config) {
    return <Badge variant="outline" className={className}>{statut}</Badge>;
  }

  return (
    <Badge variant={config.variant as any} className={`gap-1 ${className || ''}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
