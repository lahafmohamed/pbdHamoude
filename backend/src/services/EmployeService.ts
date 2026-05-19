import pool from '../db/connection';
import { BaseService } from './BaseService';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface EmployeRecord {
  id: number;
  utilisateur_id: number | null;
  matricule: string;
  nom_complet: string;
  poste: string | null;
  departement: string | null;
  date_embauche: string;
  date_naissance: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  salaire_base: number | null;
  commission_taux: number;
  actif: boolean;
  created_at: string;
}

export interface CreateEmployeInput {
  utilisateur_id?: number;
  matricule: string;
  nom_complet: string;
  poste?: string;
  departement?: string;
  date_embauche: string;
  date_naissance?: string;
  telephone?: string;
  email?: string;
  adresse?: string;
  salaire_base?: number;
  commission_taux?: number;
  req?: any;
}

export interface ShiftInput {
  employe_id: number;
  date_shift: string;
  heure_prevue_debut?: string;
  heure_prevue_fin?: string;
}

export class EmployeService extends BaseService<EmployeRecord> {
  protected tableName = 'employes';
  protected selectColumns = 'e.id, e.utilisateur_id, e.matricule, e.nom_complet, e.poste, e.departement, e.date_embauche, e.date_naissance, e.telephone, e.email, e.adresse, e.salaire_base, e.commission_taux, e.actif, e.created_at, u.username';
  protected defaultSortColumn = 'nom_complet';
  protected allowedSortColumns = ['nom_complet', 'date_embauche', 'matricule', 'departement'];

  /**
   * Get all employees with pagination
   */
  async getAll(options?: { search?: string; departement?: string; actif?: boolean; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ${this.selectColumns}
      FROM employes e
      LEFT JOIN utilisateurs u ON e.utilisateur_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.actif !== undefined) {
      query += ` AND e.actif = $${params.length + 1}`;
      params.push(options.actif);
    }

    if (options?.departement) {
      query += ` AND e.departement = $${params.length + 1}`;
      params.push(options.departement);
    }

    if (options?.search) {
      query += ` AND (e.nom_complet ILIKE $${params.length + 1} OR e.matricule ILIKE $${params.length + 2} OR e.poste ILIKE $${params.length + 3})`;
      params.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
    }

    query += ' ORDER BY e.nom_complet ASC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM employes e WHERE 1=1`;
    const countParams: any[] = [];
    if (options?.actif !== undefined) {
      countQuery += ` AND e.actif = $${countParams.length + 1}`;
      countParams.push(options.actif);
    }
    if (options?.departement) {
      countQuery += ` AND e.departement = $${countParams.length + 1}`;
      countParams.push(options.departement);
    }
    if (options?.search) {
      countQuery += ` AND (e.nom_complet ILIKE $${countParams.length + 1} OR e.matricule ILIKE $${countParams.length + 2} OR e.poste ILIKE $${countParams.length + 3})`;
      countParams.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
    }
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].total);

    return { data: rows, total };
  }

  /**
   * Get employee by ID
   */
  async getById(id: number): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT ${this.selectColumns}
       FROM employes e
       LEFT JOIN utilisateurs u ON e.utilisateur_id = u.id
       WHERE e.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Create employee
   */
  async create(input: CreateEmployeInput): Promise<EmployeRecord> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { matricule, nom_complet, poste, departement, date_embauche, date_naissance, telephone, email, adresse, salaire_base, commission_taux, utilisateur_id, req } = input;

      // Check if matricule already exists
      const { rows: existingRows } = await client.query('SELECT id FROM employes WHERE matricule = $1', [matricule]);
      if (existingRows.length > 0) {
        throw new Error(`Le matricule ${matricule} existe déjà`);
      }

      const { rows } = await client.query(
        `INSERT INTO employes (utilisateur_id, matricule, nom_complet, poste, departement, date_embauche, date_naissance, telephone, email, adresse, salaire_base, commission_taux)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [utilisateur_id || null, matricule, nom_complet, poste || null, departement || null, date_embauche, date_naissance || null, telephone || null, email || null, adresse || null, salaire_base || null, commission_taux || 0]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: utilisateur_id || (req?.user?.id),
        action: 'create',
        table_name: 'employes',
        record_id: rows[0].id,
        req,
        new_values: { matricule, nom_complet },
      });

      logger.info({ employeId: rows[0].id, matricule }, 'Employee created');

      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating employee');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record sales commission for employee
   */
  async recordCommission(employeId: number, factureId: number, montantVente: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get employee commission rate
      const { rows: employeRows } = await client.query(
        'SELECT commission_taux FROM employes WHERE id = $1 AND actif = true',
        [employeId]
      );

      if (employeRows.length === 0) {
        throw new Error('Employé non trouvé ou inactif');
      }

      const commissionTaux = employeRows[0].commission_taux;
      const montantCommission = montantVente * commissionTaux / 100;

      // Get invoice date
      const { rows: factureRows } = await client.query(
        'SELECT date_facture FROM factures WHERE id = $1',
        [factureId]
      );

      if (factureRows.length === 0) {
        throw new Error('Facture non trouvée');
      }

      // Insert commission record
      await client.query(
        `INSERT INTO commissions_ventes (employe_id, facture_id, montant_vente, taux_commission, montant_commission, date_vente)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [employeId, factureId, montantVente, commissionTaux, montantCommission, factureRows[0].date_facture]
      );

      await client.query('COMMIT');

      logger.info({ employeId, factureId, montantCommission }, 'Commission recorded');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error recording commission');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get employee commissions
   */
  async getCommissions(employeId: number, dateDebut?: string, dateFin?: string): Promise<any[]> {
    let query = `
      SELECT cv.*, f.numero_facture
      FROM commissions_ventes cv
      LEFT JOIN factures f ON cv.facture_id = f.id
      WHERE cv.employe_id = $1
    `;
    const params: any[] = [employeId];

    if (dateDebut) {
      query += ` AND cv.date_vente >= $${params.length + 1}::date`;
      params.push(dateDebut);
    }

    if (dateFin) {
      query += ` AND cv.date_vente <= $${params.length + 1}::date`;
      params.push(dateFin);
    }

    query += ' ORDER BY cv.date_vente DESC';

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Get employee commission summary
   */
  async getCommissionSummary(employeId: number, dateDebut: string, dateFin: string): Promise<any> {
    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as total_ventes,
        COALESCE(SUM(montant_vente), 0) as total_montant_ventes,
        COALESCE(SUM(montant_commission), 0) as total_commissions,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as commissions_en_attente,
        COUNT(CASE WHEN statut = 'payee' THEN 1 END) as commissions_payees
       FROM commissions_ventes
       WHERE employe_id = $1
         AND date_vente BETWEEN $2::date AND $3::date`,
      [employeId, dateDebut, dateFin]
    );
    return rows[0];
  }

  /**
   * Create or update shift
   */
  async recordShift(input: ShiftInput & { heure_debut?: string; heure_fin?: string; statut?: string; notes?: string }, userId?: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { employe_id, date_shift, heure_prevue_debut, heure_prevue_fin, heure_debut, heure_fin, statut, notes } = input;

      // Check if shift already exists
      const { rows: existingShifts } = await client.query(
        'SELECT id FROM shifts_employes WHERE employe_id = $1 AND date_shift = $2',
        [employe_id, date_shift]
      );

      if (existingShifts.length > 0) {
        // Update existing shift
        await client.query(
          `UPDATE shifts_employes 
           SET heure_prevue_debut = $1, heure_prevue_fin = $2, heure_debut = $3, heure_fin = $4, statut = $5, notes = $6
           WHERE employe_id = $7 AND date_shift = $8`,
          [heure_prevue_debut || null, heure_prevue_fin || null, heure_debut || null, heure_fin || null, statut || 'en_cours', notes || null, employe_id, date_shift]
        );
      } else {
        // Insert new shift
        await client.query(
          `INSERT INTO shifts_employes (employe_id, date_shift, heure_prevue_debut, heure_prevue_fin, heure_debut, heure_fin, statut, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [employe_id, date_shift, heure_prevue_debut || null, heure_prevue_fin || null, heure_debut || null, heure_fin || null, statut || 'prevu', notes || null]
        );
      }

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: userId,
        action: 'create',
        table_name: 'shifts_employes',
        record_id: employe_id,
        req,
        new_values: { date_shift, employe_id },
      });

      logger.info({ employe_id, date_shift }, 'Shift recorded');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error recording shift');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get employee statistics
   */
  async getStats(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) as total_employes,
        COUNT(CASE WHEN actif = true THEN 1 END) as employes_actifs,
        COUNT(CASE WHEN departement = 'Vente' THEN 1 END) as vendeurs,
        COUNT(CASE WHEN departement = 'Magasin' THEN 1 END) as magasiniers,
        COALESCE(SUM(salaire_base), 0) as masse_salariale
       FROM employes`
    );
    return rows[0];
  }
}

export const employeService = new EmployeService();
