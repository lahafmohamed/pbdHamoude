import { Request, Response } from 'express';
import { stockLocationService } from '../services/StockLocationService';
import { successResponse, paginatedResponse } from '../utils/response';

export class StockLocationController {
  /**
   * Get all stock locations
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, actif } = req.query;

      const locations = await stockLocationService.getAll({
        search: search as string,
        actif: actif === 'true' ? true : actif === 'false' ? false : undefined,
      });

      successResponse(res, locations, 'Locations récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get stock location by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const location = await stockLocationService.getById(parseInt(id));

      if (!location) {
        res.status(404).json({ success: false, error: 'Location non trouvée' });
        return;
      }

      successResponse(res, location, 'Location récupérée avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create stock location
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const { code, nom, adresse, responsable_id, est_principal } = req.body;

      if (!code || !nom) {
        res.status(400).json({ success: false, error: 'Code et nom sont requis' });
        return;
      }

      const location = await stockLocationService.create({
        code,
        nom,
        adresse,
        responsable_id,
        est_principal,
        req,
      });

      res.status(201).json({ success: true, data: location, message: 'Location créée avec succès' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get stock levels for a location
   */
  static async getStockLevels(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const stockLevels = await stockLocationService.getStockLevels(parseInt(id));

      successResponse(res, stockLevels, 'Niveaux de stock récupérés avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get products with stock for a location (optimized for cart selection)
   */
  static async getProductsWithStock(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { search, limit } = req.query;
      const locationId = parseInt(id);
      const searchTerm = (search as string) || '';
      const limitNum = limit ? parseInt(limit as string, 10) : 100;

      const products = await stockLocationService.getProductsWithStock(locationId, searchTerm, limitNum);

      successResponse(res, products, 'Produits récupérés avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
