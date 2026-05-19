import { Request, Response } from 'express';
import { DevisService } from '../services/DevisService';
import { pdfService } from '../services/PDFService';
import { AuthRequest } from '../middleware/auth';

const devisService = new DevisService();

export class DevisController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, statut, tiers_id, client_id, page, limit, sort, order } = req.query;
      const result = await devisService.getAll(
        search as string,
        statut as string,
        (tiers_id || client_id) ? parseInt((tiers_id || client_id) as string) : undefined,
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20,
        (sort as string) || 'date_devis',
        (order as string) || 'DESC'
      );
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const devis = await devisService.getById(parseInt(req.params.id));
      if (!devis) {
        res.status(404).json({ success: false, error: 'Devis non trouvé' });
        return;
      }
      res.json({ success: true, data: devis });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tiers_id, client_id, lignes, date_validite, notes, conditions, location_id, remise_globale, remise_globale_pct } = req.body;
      const resolvedTiersId = tiers_id ?? client_id;

      if (!resolvedTiersId || !lignes || lignes.length === 0) {
        res.status(400).json({ success: false, error: 'tiers_id and lignes are required' });
        return;
      }

      const result = await devisService.create({
        tiers_id: resolvedTiersId,
        lignes,
        date_validite,
        notes,
        conditions,
        location_id,
        remise_globale,
        remise_globale_pct,
        cree_par: req.user?.id,
        req,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la creation du devis';
      const status = typeof error?.statusCode === 'number'
        ? error.statusCode
        : (msg.includes('requis')
            || msg.includes('Location invalide')
            || msg.includes('depot')
            || msg.includes('dépôt')
            || msg.includes('devis'))
        ? 400
        : 500;
      const payload: any = { success: false, error: msg };
      if (Array.isArray(error?.offending_lines)) {
        payload.offending_lines = error.offending_lines;
      }
      res.status(status).json(payload);
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await devisService.update(parseInt(req.params.id), req.body, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la mise a jour du devis';
      const status = typeof error?.statusCode === 'number'
        ? error.statusCode
        : (msg.includes('Devis non trouvé')
            || msg.includes('Cannot modify')
            || msg.includes('Location invalide')
            || msg.includes('depot')
            || msg.includes('dépôt'))
        ? 400
        : 500;
      const payload: any = { success: false, error: msg };
      if (Array.isArray(error?.offending_lines)) {
        payload.offending_lines = error.offending_lines;
      }
      res.status(status).json(payload);
    }
  }

  static async updateStatut(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { statut } = req.body;
      if (!statut) {
        res.status(400).json({ success: false, error: 'statut is required' });
        return;
      }
      await devisService.updateStatut(parseInt(req.params.id), statut, req);
      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async convertToFacture(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await devisService.convertToFacture(parseInt(req.params.id), req.user!.id, req);
      res.json({ success: true, data: result });
    } catch (error: any) {
      const msg = error?.message || 'Erreur lors de la conversion';
      const isBusinessError =
        msg.includes('Devis non trouvé') ||
        msg.includes('déjà converti') ||
        msg.includes('Impossible de convertir') ||
        msg.includes('must be accepted');

      res.status(isBusinessError ? 400 : 500).json({ success: false, error: msg });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      await devisService.delete(parseInt(req.params.id), req);
      res.json({ success: true, message: 'Devis supprimé' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async generatePDF(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const buffer = await pdfService.generateDevisPDF(parseInt(id));
      const devis = await devisService.getById(parseInt(id));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="devis-${devis?.numero_devis || id}.pdf"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
