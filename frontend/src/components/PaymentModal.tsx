import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { METHODES_PAIEMENT } from '../types';
import { MoneyInput } from './ui/money-input';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { formatFCFA } from '../utils/format';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (paiement: {
    montant: number;
    methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement';
    reference?: string;
    notes?: string;
  }) => Promise<void>;
  remainingDue: number;
  total: number;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  remainingDue,
  total,
}) => {
  const [montant, setMontant] = useState('');
  const [methodePaiement, setMethodePaiement] = useState<'espece' | 'carte' | 'cheque' | 'virement'>('espece');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMontant(parseFloat(remainingDue as any).toFixed(2));
      setMethodePaiement('espece');
      setReference('');
      setNotes('');
      setError('');
    }
  }, [isOpen, remainingDue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const montantNum = parseFloat(montant);

    if (isNaN(montantNum) || montantNum <= 0) {
      setError('Le montant doit être supérieur à 0');
      return;
    }

    if (montantNum > remainingDue) {
      setError(`Le montant ne peut pas dépasser le reste dû (${formatFCFA(remainingDue)})`);
      return;
    }

    setLoading(true);

    try {
      await onSubmit({
        montant: montantNum,
        methode_paiement: methodePaiement,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || "Une erreur est survenue lors de l'enregistrement du paiement");
    } finally {
      setLoading(false);
    }
  };

  const handleSetFullAmount = () => {
    setMontant(parseFloat(remainingDue as any).toFixed(2));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="payment-amount">Montant du paiement</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleSetFullAmount} className="h-7 text-xs">
                Payer le reste ({formatFCFA(remainingDue)})
              </Button>
            </div>
            <MoneyInput
              value={montant}
              onChange={(v) => setMontant(v)}
              placeholder="0"
              required
            />
            <p className="text-xs text-muted-foreground num">
              Total facture: {formatFCFA(total)} · Déjà payé: {formatFCFA(total - remainingDue)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Méthode de paiement</Label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(METHODES_PAIEMENT).map(([key, config]) => {
                const MethodIcon = config.Icon;
                const active = methodePaiement === key;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => setMethodePaiement(key as any)}
                    className="justify-start gap-2"
                  >
                    <MethodIcon className="h-4 w-4" />
                    {config.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-reference">
              Référence {methodePaiement === 'cheque' || methodePaiement === 'virement' ? '(requis)' : '(optionnel)'}
            </Label>
            <Input
              id="payment-reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                methodePaiement === 'cheque'
                  ? 'N° du chèque'
                  : methodePaiement === 'virement'
                  ? 'Référence du virement'
                  : ''
              }
              required={methodePaiement === 'cheque' || methodePaiement === 'virement'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-notes">Notes (optionnel)</Label>
            <Textarea
              id="payment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ajouter des notes ou commentaires"
              rows={3}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enregistrement…
                </>
              ) : (
                'Enregistrer le paiement'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
