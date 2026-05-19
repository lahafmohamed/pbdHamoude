import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';

interface Ligne {
  id: number;
  produit_id: number;
  produit_nom: string;
  reference: string;
  quantite_demandee: number;
  quantite_approuvee: number | null;
  notes: string | null;
}

interface DemandeDecisionDialogProps {
  demande: {
    id: number;
    numero: string;
    lignes: Ligne[];
  };
  onClose: () => void;
  onSubmit: (payload: {
    decision: 'approuvee' | 'refusee';
    lignes_decision?: { ligne_id: number; quantite_approuvee: number }[];
    raison_refus?: string;
  }) => void;
  loading: boolean;
}

export function DemandeDecisionDialog({ demande, onClose, onSubmit, loading }: DemandeDecisionDialogProps) {
  const [decision, setDecision] = useState<'approuvee' | 'refusee' | null>(null);
  const [ligneDecisions, setLigneDecisions] = useState<Record<number, number>>(() => {
    // Initialize with requested quantities
    const initial: Record<number, number> = {};
    demande.lignes.forEach((l) => {
      initial[l.id] = l.quantite_demandee;
    });
    return initial;
  });
  const [raisonRefus, setRaisonRefus] = useState('');

  const handleApproveAll = () => {
    setDecision('approuvee');
    // Keep all at requested quantities
    const allApproved: Record<number, number> = {};
    demande.lignes.forEach((l) => {
      allApproved[l.id] = l.quantite_demandee;
    });
    setLigneDecisions(allApproved);
  };

  const handleRefuseAll = () => {
    setDecision('refusee');
    // Set all to 0
    const allRefused: Record<number, number> = {};
    demande.lignes.forEach((l) => {
      allRefused[l.id] = 0;
    });
    setLigneDecisions(allRefused);
  };

  const handleLigneChange = (ligneId: number, value: number) => {
    setLigneDecisions((prev) => {
      const next = {
        ...prev,
        [ligneId]: Math.max(0, Math.min(value, demande.lignes.find((l) => l.id === ligneId)?.quantite_demandee || 0)),
      };
      // Auto-derive decision from edited quantities
      const allZero = demande.lignes.every((l) => (next[l.id] ?? 0) === 0);
      setDecision(allZero ? 'refusee' : 'approuvee');
      return next;
    });
  };

  const isPartial = () => {
    return demande.lignes.some((l) => ligneDecisions[l.id] < l.quantite_demandee && ligneDecisions[l.id] > 0);
  };

  const isAllRefused = () => {
    return demande.lignes.every((l) => ligneDecisions[l.id] === 0);
  };

  const handleSubmit = () => {
    if (!decision) return;

    if (decision === 'refusee' && !raisonRefus && !isAllRefused()) {
      // Refusal requires reason
    }

    const payload: any = {
      decision,
    };

    if (decision === 'approuvee' || (decision === 'refusee' && !isAllRefused())) {
      payload.lignes_decision = demande.lignes.map((l) => ({
        ligne_id: l.id,
        quantite_approuvee: ligneDecisions[l.id],
      }));
    }

    if (decision === 'refusee' || isAllRefused()) {
      payload.raison_refus = raisonRefus || 'Demande refusée';
    }

    onSubmit(payload);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prendre une décision</DialogTitle>
          <DialogDescription>
            Demande {demande.numero} — Approuvez, refusez ou ajustez les quantités
          </DialogDescription>
        </DialogHeader>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <Button
            variant={decision === 'approuvee' && !isPartial() ? 'default' : 'outline'}
            className="flex-1 gap-2"
            onClick={handleApproveAll}
          >
            <CheckCircle className="h-4 w-4" />
            Tout approuver
          </Button>
          <Button
            variant={decision === 'refusee' ? 'destructive' : 'outline'}
            className="flex-1 gap-2"
            onClick={handleRefuseAll}
          >
            <XCircle className="h-4 w-4" />
            Tout refuser
          </Button>
        </div>

        {/* Line Items */}
        <div className="space-y-4">
          <Label>Lignes de demande</Label>
          {demande.lignes.map((ligne) => (
            <div key={ligne.id} className="flex items-center gap-4 p-3 border rounded-lg">
              <div className="flex-1">
                <div className="font-medium">{ligne.produit_nom}</div>
                <div className="text-sm text-muted-foreground">{ligne.reference}</div>
              </div>
              <div className="text-center px-4">
                <div className="text-xs text-muted-foreground">Demandée</div>
                <div className="font-medium">{ligne.quantite_demandee}</div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Approuvée:</Label>
                <Input
                  type="number"
                  min={0}
                  max={ligne.quantite_demandee}
                  value={ligneDecisions[ligne.id]}
                  onChange={(e) => handleLigneChange(ligne.id, parseInt(e.target.value) || 0)}
                  className="w-20 text-center"
                />
              </div>
              {ligneDecisions[ligne.id] < ligne.quantite_demandee && (
                <Badge variant={ligneDecisions[ligne.id] === 0 ? 'destructive' : 'warning'} className="shrink-0">
                  {ligneDecisions[ligne.id] === 0 ? 'Refusé' : 'Partiel'}
                </Badge>
              )}
              {ligneDecisions[ligne.id] === ligne.quantite_demandee && (
                <Badge variant="success" className="shrink-0">
                  Complet
                </Badge>
              )}
            </div>
          ))}
        </div>

        {/* Reason for refusal */}
        {(decision === 'refusee' || isAllRefused()) && (
          <div className="space-y-2">
            <Label htmlFor="raison_refus">
              Motif du refus <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="raison_refus"
              placeholder="Expliquez pourquoi la demande est refusée..."
              value={raisonRefus}
              onChange={(e) => setRaisonRefus(e.target.value)}
              required
            />
            {isAllRefused() && !raisonRefus && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Le motif est requis pour un refus total
              </p>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="bg-muted p-3 rounded-lg">
          <div className="text-sm">
            <span className="font-medium">Résumé: </span>
            {isAllRefused() ? (
              <span className="text-destructive">Refus total</span>
            ) : isPartial() ? (
              <span className="text-warning">Approbation partielle</span>
            ) : (
                  <span className="text-success">Approbation complète</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !decision || (isAllRefused() && !raisonRefus)}
            variant={decision === 'refusee' || isAllRefused() ? 'destructive' : 'default'}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : decision === 'refusee' || isAllRefused() ? (
              <XCircle className="h-4 w-4 mr-2" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
