import { Request, Response } from 'express';
import { CreditNoteService } from '../services/CreditNoteService';
import { pdfService } from '../services/PDFService';
import { AuthRequest } from '../middleware/auth';

const creditNoteService = new CreditNoteService();

export class CreditNoteController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut, tiers_id, client_id, page, limit, sort, order } = req.query;
      const result = await creditNoteService.getAll(
        search as string,
        statut as string,
        (tiers_id || client_id) ? parseInt((tiers_id || client_id) as string) : undefined,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20,
        (sort as string) || 'date_avoir',
        (order as string) || 'DESC'
      );
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const avoir = await creditNoteService.getById(parseInt(req.params.id));
      if (!avoir) {
        res.status(404).json({ success: false, error: 'Avoir non trouvé' });
        return;
      }
      res.json({ success: true, data: avoir });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async createFromRetour(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { retour_id } = req.body;
      
      if (!retour_id) {
        res.status(400).json({ success: false, error: 'retour_id is required' });
        return;
      }

      const result = await creditNoteService.createFromRetour(retour_id, req.user!.id, req);
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async createManual(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tiers_id, client_id, facture_origine_id, retour_id, lignes, avoir_type, notes, location_id } = req.body;
      const resolvedTiersId = tiers_id ?? client_id;

      if (!resolvedTiersId || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'tiers_id and lignes are required' });
        return;
      }

      const result = await creditNoteService.createManual({
        tiers_id: resolvedTiersId,
        facture_origine_id,
        retour_id,
        lignes,
        avoir_type,
        notes,
        location_id,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la création de l\'avoir';
      const isBusinessError =
        msg.includes('facture') ||
        msg.includes('Facture') ||
        msg.includes('client') ||
        msg.includes('Client') ||
        msg.includes('avoir') ||
        msg.includes('validée') ||
        msg.includes('validée');

      res.status(isBusinessError ? 400 : 500).json({ success: false, error: msg });
    }
  }

  static async updateStatut(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { statut } = req.body;
      if (!statut) {
        res.status(400).json({ success: false, error: 'statut is required' });
        return;
      }
      await creditNoteService.updateStatut(parseInt(req.params.id), statut, req);
      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await creditNoteService.delete(parseInt(req.params.id), req);
      res.json({ success: true, message: 'Avoir supprimé' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async applyToFacture(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { facture_id } = req.body;
      if (!facture_id) {
        res.status(400).json({ success: false, error: 'facture_id is required' });
        return;
      }
      await creditNoteService.applyToFacture(parseInt(id), parseInt(facture_id), req);
      res.json({ success: true, message: 'Avoir appliqué à la facture' });
    } catch (error: any) {
      const isBusinessError =
        error.message?.includes('non trouvé') ||
        error.message?.includes('doit être') ||
        error.message?.includes('Impossible') ||
        error.message?.includes('même client');
      res.status(isBusinessError ? 400 : 500).json({ success: false, error: error.message });
    }
  }

  static async generatePDF(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const buffer = await pdfService.generateAvoirPDF(parseInt(id));
      const avoir = await creditNoteService.getById(parseInt(id));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="avoir-${avoir?.numero_avoir || id}.pdf"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
