import { Request, Response } from 'express';
import { BonLivraisonService } from '../services/BonLivraisonService';
import { pdfService } from '../services/PDFService';
import { AuthRequest } from '../middleware/auth';

const blService = new BonLivraisonService();

export class BonLivraisonController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut, tiers_id, client_id, page, limit, sort, order } = req.query;
      const result = await blService.getAll(
        search as string,
        statut as string,
        (tiers_id || client_id) ? parseInt((tiers_id || client_id) as string) : undefined,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20,
        (sort as string) || 'date_bl',
        (order as string) || 'DESC'
      );
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const bl = await blService.getById(parseInt(req.params.id));
      if (!bl) {
        res.status(404).json({ success: false, error: 'Bon de livraison non trouvé' });
        return;
      }
      res.json({ success: true, data: bl });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tiers_id, client_id, devis_id, lignes, notes, adresse_livraison, date_livraison_prevue, location_id } = req.body;
      const resolvedTiersId = tiers_id ?? client_id;

      if (!resolvedTiersId || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'tiers_id and lignes are required' });
        return;
      }

      const result = await blService.create({
        tiers_id: resolvedTiersId,
        devis_id,
        lignes,
        notes,
        adresse_livraison,
        date_livraison_prevue,
        location_id,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la création du bon de livraison';
      const isBusinessError =
        msg.includes('devis') ||
        msg.includes('Devis') ||
        msg.includes('client') ||
        msg.includes('Client') ||
        msg.includes('doit') ||
        msg.includes('Impossible');

      res.status(isBusinessError ? 400 : 500).json({ success: false, error: msg });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await blService.update(parseInt(req.params.id), req.body, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async updateStatut(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { statut } = req.body;
      if (!statut) {
        res.status(400).json({ success: false, error: 'statut is required' });
        return;
      }
      await blService.updateStatut(parseInt(req.params.id), statut, req);
      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la mise à jour du statut';
      res.status(400).json({ success: false, error: msg });
    }
  }

  static async convertToFacture(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await blService.convertToFacture(parseInt(req.params.id), req.user!.id, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la conversion en facture';
      res.status(400).json({ success: false, error: msg });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await blService.delete(parseInt(req.params.id), req);
      res.json({ success: true, message: 'Bon de livraison supprimé' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async generatePDF(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const buffer = await pdfService.generateBLPDF(parseInt(id));
      const bl = await blService.getById(parseInt(id));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="bl-${bl?.numero_bl || id}.pdf"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
