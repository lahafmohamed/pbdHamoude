import { Request, Response } from 'express';
import { factureFournisseurService } from '../services/FactureFournisseurService';
import { successResponse, paginatedResponse } from '../utils/response';

export class FactureFournisseurController {
  /**
   * Get all supplier invoices
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut, tiers_id, fournisseur_id, page, limit } = req.query;

      const invoices = await factureFournisseurService.getAll({
        search: search as string,
        statut: statut as string,
        tiers_id: tiers_id ? parseInt(tiers_id as string) : undefined,
        fournisseur_id: fournisseur_id ? parseInt(fournisseur_id as string) : undefined,
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 20,
      });

      paginatedResponse(res, invoices.data, invoices.total, parseInt(page as string) || 1, parseInt(limit as string) || 20, 'Factures fournisseur récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get supplier invoice by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const invoice = await factureFournisseurService.getById(parseInt(id));

      if (!invoice) {
        res.status(404).json({ success: false, error: 'Facture fournisseur non trouvée' });
        return;
      }

      successResponse(res, invoice, 'Facture fournisseur récupérée avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create supplier invoice
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const { tiers_id, fournisseur_id, reception_id, numero_facture_fournisseur, date_facture, date_echeance, condition_paiement, lignes, notes } = req.body;
      const resolvedTiersId = tiers_id ?? fournisseur_id;

      if (!resolvedTiersId || !numero_facture_fournisseur || !date_facture || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'Fournisseur, numéro de facture, date et lignes sont requis' });
        return;
      }

      const invoice = await factureFournisseurService.create({
        tiers_id: resolvedTiersId,
        reception_id,
        numero_facture_fournisseur,
        date_facture,
        date_echeance,
        condition_paiement,
        lignes,
        notes,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: invoice, message: 'Facture fournisseur créée avec succès' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Record payment for supplier invoice
   */
  static async recordPayment(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { montant, methode_paiement, reference } = req.body;

      if (!montant || !methode_paiement) {
        res.status(400).json({ success: false, error: 'Montant et méthode de paiement sont requis' });
        return;
      }

      await factureFournisseurService.recordPayment(
        parseInt(id),
        montant,
        methode_paiement,
        reference,
        req.user?.id,
        req
      );

      successResponse(res, null, 'Paiement enregistré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get payable invoices
   */
  static async getPayableInvoices(req: Request, res: Response): Promise<void> {
    try {
      const invoices = await factureFournisseurService.getPayableInvoices();
      successResponse(res, invoices, 'Factures payables récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get supplier invoice statistics
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await factureFournisseurService.getStats();
      successResponse(res, stats, 'Statistiques récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
