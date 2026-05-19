import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Package, AlertCircle } from 'lucide-react';

interface Ligne {
  id: number;
  produit_id: number;
  produit_nom: string;
  reference: string;
  quantite_demandee: number;
  quantite_approuvee: number | null;
  quantite_livree: number | null;
}

interface DemandeClotureDialogProps {
  demande: {
    id: number;
    numero: string;
    numero_transfer: string | null;
    lignes: Ligne[];
  };
  onClose: () => void;
  onSubmit: () => void;
  loading: boolean;
}

export function DemandeClotureDialog({ demande, onClose, onSubmit, loading }: DemandeClotureDialogProps) {
  const hasDiscrepancy = demande.lignes.some((l) => {
    const approved = l.quantite_approuvee ?? l.quantite_demandee;
    return (l.quantite_livree ?? 0) < approved;
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-success" />
            Clôturer la demande
          </DialogTitle>
          <DialogDescription>
            Confirmez la réception des produits au magasin pour finaliser la demande {demande.numero}
          </DialogDescription>
        </DialogHeader>

        {/* Transfer Info */}
        {demande.numero_transfer && (
          <div className="bg-muted/50 p-3 rounded-lg flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              Transfert associé: <span className="font-medium">{demande.numero_transfer}</span>
            </span>
          </div>
        )}

        {/* Delivery Summary */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Résumé de la livraison</h4>
          <div className="border rounded-lg divide-y">
            {demande.lignes.map((ligne) => {
              const approved = ligne.quantite_approuvee ?? ligne.quantite_demandee;
              const delivered = ligne.quantite_livree ?? 0;
              const complete = delivered >= approved;

              return (
                <div key={ligne.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{ligne.produit_nom}</div>
                    <div className="text-xs text-muted-foreground">{ligne.reference}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      <span className="font-medium">{delivered}</span>
                      <span className="text-muted-foreground"> / {approved} livré</span>
                    </div>
                    <Badge variant={complete ? 'success' : 'warning'} className="text-xs mt-1">
                      {complete ? 'Complet' : 'Partiel'}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Warnings */}
        {hasDiscrepancy && (
          <div className="bg-warning/10 border border-warning/20 p-3 rounded-lg flex gap-2">
            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-medium text-warning">Attention: </span>
              Certaines quantités livrées sont inférieures aux quantités approuvées. 
              Vous pouvez quand même clôturer la demande.
            </div>
          </div>
        )}

        {/* Confirmation */}
        <div className="bg-success/10 border border-success/20 p-3 rounded-lg">
          <p className="text-sm text-success">
            En clôturant cette demande, vous confirmez avoir reçu physiquement les produits 
            listés ci-dessus. Cette action est définitive.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={onSubmit} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Confirmer la réception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
