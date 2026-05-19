import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Eye, Lock } from 'lucide-react';
import { usePermission } from '../hooks/usePermission';

interface StockLocationGateProps {
  locationType: 'depot' | 'magasin';
  locationId?: number;
  locationName?: string;
  children: React.ReactNode;
  showBanner?: boolean;
}

/**
 * Component that gates access to stock operations based on location type
 * Shows read-only banner when user views cross-location stock
 */
export function StockLocationGate({
  locationType,
  locationName,
  children,
  showBanner = true,
}: StockLocationGateProps) {
  const { canAccessLocation, userRole } = usePermission();

  const canRead = canAccessLocation(locationType, 'read');
  const canWrite = canAccessLocation(locationType, 'write');

  // If user can't even read, show lock message
  if (!canRead) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <Lock className="h-12 w-12 mx-auto mb-4 text-destructive/60" />
          <h3 className="text-lg font-medium text-destructive">Accès refusé</h3>
          <p className="text-sm text-muted-foreground mt-2">
            Vous n&apos;avez pas les droits pour accéder au stock {locationType === 'depot' ? 'du dépôt' : 'du magasin'}
            {locationName && ` (${locationName})`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      {showBanner && !canWrite && (
        <Card className="bg-muted/50 border-warning/30">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Vue en lecture seule</span>
                <Badge variant="outline" className="text-xs">
                  {userRole}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Vous visualisez le stock {locationType === 'depot' ? 'du dépôt' : 'du magasin'}
                {locationName && ` (${locationName})`} en mode lecture seule.
                {locationType === 'depot' 
                  ? ' Les modifications de stock dépôt sont réservées au personnel du dépôt.'
                  : ' Les modifications de stock magasin sont réservées au personnel du magasin.'}
              </p>
            </div>
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      )}

      {/* Content with opacity adjustment for read-only */}
      <div className={!canWrite ? 'opacity-95' : ''}>
        {children}
      </div>
    </div>
  );
}

/**
 * Hook to check if current operation on a location should be disabled
 */
export function useStockLocationGate(locationType: 'depot' | 'magasin') {
  const { canAccessLocation, getActionState: _getActionState } = usePermission();

  const canRead = canAccessLocation(locationType, 'read');
  const canWrite = canAccessLocation(locationType, 'write');

  const getOperationState = (operation: 'view' | 'adjust' | 'edit' | 'delete') => {
    switch (operation) {
      case 'view':
        return {
          disabled: !canRead,
          tooltip: canRead ? null : 'Vous n\'avez pas accès à cette location',
          readOnly: false,
        };
      case 'adjust':
      case 'edit':
      case 'delete':
        return {
          disabled: !canWrite,
          tooltip: canWrite 
            ? null 
            : `Modification réservée au personnel ${locationType === 'depot' ? 'du dépôt' : 'du magasin'}`,
          readOnly: !canWrite,
        };
      default:
        return { disabled: true, tooltip: 'Opération non autorisée', readOnly: true };
    }
  };

  return {
    canRead,
    canWrite,
    getOperationState,
    isReadOnly: !canWrite,
  };
}

export default StockLocationGate;
