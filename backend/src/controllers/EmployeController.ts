import { Request, Response } from 'express';
import { employeService } from '../services/EmployeService';
import { successResponse, paginatedResponse } from '../utils/response';

export class EmployeController {
  /**
   * Get all employees
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, departement, actif, page, limit } = req.query;

      const employees = await employeService.getAll({
        search: search as string,
        departement: departement as string,
        actif: actif === 'true' ? true : actif === 'false' ? false : undefined,
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 20,
      });

      paginatedResponse(res, employees.data, employees.total, parseInt(page as string) || 1, parseInt(limit as string) || 20, 'Employés récupérés avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get employee by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const employee = await employeService.getById(parseInt(id));

      if (!employee) {
        res.status(404).json({ success: false, error: 'Employé non trouvé' });
        return;
      }

      successResponse(res, employee, 'Employé récupéré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Create employee
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const { utilisateur_id, matricule, nom_complet, poste, departement, date_embauche, date_naissance, telephone, email, adresse, salaire_base, commission_taux } = req.body;

      if (!matricule || !nom_complet || !date_embauche) {
        res.status(400).json({ success: false, error: 'Matricule, nom complet et date d\'embauche sont requis' });
        return;
      }

      const employee = await employeService.create({
        utilisateur_id,
        matricule,
        nom_complet,
        poste,
        departement,
        date_embauche,
        date_naissance,
        telephone,
        email,
        adresse,
        salaire_base,
        commission_taux,
        req,
      });

      res.status(201).json({ success: true, data: employee, message: 'Employé créé avec succès' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Record commission for employee
   */
  static async recordCommission(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { facture_id, montant_vente } = req.body;

      if (!facture_id || !montant_vente) {
        res.status(400).json({ success: false, error: 'Facture et montant de vente sont requis' });
        return;
      }

      await employeService.recordCommission(parseInt(id), facture_id, montant_vente, req);

      successResponse(res, null, 'Commission enregistrée avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get employee commissions
   */
  static async getCommissions(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { date_debut, date_fin } = req.query;

      const commissions = await employeService.getCommissions(
        parseInt(id),
        date_debut as string,
        date_fin as string
      );

      successResponse(res, commissions, 'Commissions récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get employee commission summary
   */
  static async getCommissionSummary(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { date_debut, date_fin } = req.query;

      if (!date_debut || !date_fin) {
        res.status(400).json({ success: false, error: 'Date de début et de fin sont requises' });
        return;
      }

      const summary = await employeService.getCommissionSummary(parseInt(id), date_debut as string, date_fin as string);
      successResponse(res, summary, 'Résumé des commissions récupéré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Record employee shift
   */
  static async recordShift(req: Request, res: Response): Promise<void> {
    try {
      const { employe_id, date_shift, heure_prevue_debut, heure_prevue_fin, heure_debut, heure_fin, statut, notes } = req.body;

      if (!employe_id || !date_shift) {
        res.status(400).json({ success: false, error: 'Employé et date du shift sont requis' });
        return;
      }

      await employeService.recordShift({
        employe_id,
        date_shift,
        heure_prevue_debut,
        heure_prevue_fin,
        heure_debut,
        heure_fin,
        statut,
        notes,
      }, req.user?.id, req);

      successResponse(res, null, 'Shift enregistré avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get employee statistics
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await employeService.getStats();
      successResponse(res, stats, 'Statistiques employés récupérées avec succès');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
