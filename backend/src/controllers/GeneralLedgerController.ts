import { Request, Response } from 'express';
import { generalLedgerService } from '../services/GeneralLedgerService';
import { successResponse, paginatedResponse } from '../utils/response';

export class GeneralLedgerController {
  /**
   * Get all journal entries
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { journal, date_debut, date_fin, compte_id, page, limit } = req.query;

      const entries = await generalLedgerService.getAll({
        journal: journal as string,
        date_debut: date_debut as string,
        date_fin: date_fin as string,
        compte_id: parseInt(compte_id as string),
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 50,
      });

      paginatedResponse(res, entries.data, entries.total, parseInt(page as string) || 1, parseInt(limit as string) || 50, 'Écritures comptables récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get chart of accounts
   */
  static async getChartOfAccounts(req: Request, res: Response): Promise<void> {
    try {
      const { actif_only } = req.query;
      const accounts = await generalLedgerService.getChartOfAccounts(actif_only !== 'false');
      successResponse(res, accounts, 'Plan comptable récupéré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get trial balance
   */
  static async getTrialBalance(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;

      if (!date_debut || !date_fin) {
        res.status(400).json({ success: false, error: 'Date de début et de fin sont requises' });
        return;
      }

      const balance = await generalLedgerService.getTrialBalance(date_debut as string, date_fin as string);
      successResponse(res, balance, 'Balance comptable récupérée avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get account ledger
   */
  static async getAccountLedger(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { date_debut, date_fin } = req.query;

      if (!date_debut || !date_fin) {
        res.status(400).json({ success: false, error: 'Date de début et de fin sont requises' });
        return;
      }

      const ledger = await generalLedgerService.getAccountLedger(parseInt(id), date_debut as string, date_fin as string);
      successResponse(res, ledger, 'Grand livre du compte récupéré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get journal entries by document
   */
  static async getByDocument(req: Request, res: Response): Promise<void> {
    try {
      const { pieceType, pieceId } = req.params;
      const entries = await generalLedgerService.getByDocument(pieceType, parseInt(pieceId));
      successResponse(res, entries, 'Écritures par document récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create manual journal entry
   */
  static async createManualEntry(req: Request, res: Response): Promise<void> {
    try {
      const { numero_piece, journal, date_ecriture, lignes } = req.body;

      if (!numero_piece || !journal || !date_ecriture || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'Numéro de pièce, journal, date et lignes sont requis' });
        return;
      }

      await generalLedgerService.createManualEntry(
        numero_piece,
        journal,
        date_ecriture,
        lignes,
        req.user?.id
      );

      res.status(201).json({ success: true, message: 'Écriture comptable créée avec succès' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get accounting statistics
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;
      const stats = await generalLedgerService.getStats(date_debut as string, date_fin as string);
      successResponse(res, stats, 'Statistiques comptables récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get journal breakdown
   */
  static async getJournalBreakdown(req: Request, res: Response): Promise<void> {
    try {
      const { date_debut, date_fin } = req.query;

      if (!date_debut || !date_fin) {
        res.status(400).json({ success: false, error: 'Date de début et de fin sont requises' });
        return;
      }

      const breakdown = await generalLedgerService.getJournalBreakdown(date_debut as string, date_fin as string);
      successResponse(res, breakdown, 'Répartition par journal récupérée avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
