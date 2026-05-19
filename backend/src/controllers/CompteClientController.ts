import { Request, Response } from 'express';
import { compteClientService } from '../services/CompteClientService';
import { ClientAllocationService } from '../services/ClientAllocationService';
import { AuthRequest } from '../middleware/auth';

export class CompteClientController {
  /**
   * Record advance payment
   */
  static async recordAdvance(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { clientId } = req.params;
      const { montant, methode_paiement, notes } = req.body;

      if (!montant || !methode_paiement) {
        res.status(400).json({ error: 'Montant et methode_paiement requis' });
        return;
      }

      const result = await compteClientService.recordAdvance(
        parseInt(clientId),
        montant,
        methode_paiement,
        notes,
        authReq.user!.id
      );

      // Recompute FIFO allocation so this acompte is immediately applied to invoices
      await ClientAllocationService.recomputeClientAllocations(parseInt(clientId));

      res.status(201).json({
        success: true,
        data: result,
        message: 'Acompte enregistré avec succès',
      });
    } catch (error: any) {
      console.error('Erreur POST /api/clients/:id/acomptes:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get customer current balance
   */
  static async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const { clientId } = req.params;

      const balance = await compteClientService.getBalance(parseInt(clientId));
      res.json({ success: true, data: balance });
    } catch (error: any) {
      console.error('Erreur GET /api/clients/:id/solde:', error);
      if (error.message === 'Client non trouvé') {
        res.status(404).json({ error: 'Client non trouvé' });
        return;
      }
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get account statement (relevé de compte)
   */
  static async getAccountStatement(req: Request, res: Response): Promise<void> {
    try {
      const { clientId } = req.params;
      const { date_debut, date_fin } = req.query;

      const statement = await compteClientService.getAccountStatement(
        parseInt(clientId),
        date_debut as string,
        date_fin as string
      );

      res.json({ success: true, data: statement });
    } catch (error: any) {
      console.error('Erreur GET /api/clients/:id/releve:', error);
      if (error.message === 'Client non trouvé') {
        res.status(404).json({ error: 'Client non trouvé' });
        return;
      }
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Get customer aging report
   */
  static async getAging(req: Request, res: Response): Promise<void> {
    try {
      const { clientId } = req.params;

      const aging = await compteClientService.getAging(parseInt(clientId));
      res.json({ success: true, data: aging });
    } catch (error: any) {
      console.error('Erreur GET /api/clients/:id/aging:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * Apply advance to invoice
   */
  static async applyAdvance(req: Request, res: Response): Promise<void> {
    try {
      const { clientId } = req.params;
      const { facture_id, acompte_id } = req.body;

      if (!facture_id || !acompte_id) {
        res.status(400).json({ error: 'facture_id et acompte_id requis' });
        return;
      }

      const result = await compteClientService.applyAdvanceToInvoice(
        parseInt(clientId),
        facture_id,
        acompte_id
      );

      // Recompute FIFO allocation to reflect the manual application
      await ClientAllocationService.recomputeClientAllocations(parseInt(clientId));

      res.json({
        success: true,
        data: result,
        message: 'Acompte appliqué avec succès',
      });
    } catch (error: any) {
      console.error('Erreur POST /api/clients/:id/apply-acompte:', error);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Record manual ledger line
   */
  static async recordLedgerLine(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthRequest;
      const { clientId } = req.params;
      const { type_operation, montant_debit, montant_credit, document_numero, notes } = req.body;

      if (!type_operation) {
        res.status(400).json({ error: 'type_operation requis' });
        return;
      }

      const result = await compteClientService.recordLedgerLine(
        parseInt(clientId),
        type_operation,
        montant_debit || 0,
        montant_credit || 0,
        document_numero,
        notes,
        authReq.user!.id
      );

      res.status(201).json({
        success: true,
        data: result,
        message: 'Opération enregistrée',
      });
    } catch (error: any) {
      console.error('Erreur POST /api/clients/:id/ledger:', error);
      res.status(400).json({ error: error.message });
    }
  }
}
