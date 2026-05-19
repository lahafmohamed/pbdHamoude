import pool from '../db/connection';
import { BaseService } from './BaseService';
import { logger } from '../utils/logger';

export interface EcritureComptableRecord {
  id: number;
  numero_piece: string | null;
  date_ecriture: string;
  journal: string;
  piece_id: number | null;
  piece_type: string | null;
  ligne_numero: number;
  compte_id: number;
  debit: number;
  credit: number;
  description: string | null;
  created_at: string;
}

export interface PlanComptableRecord {
  id: number;
  numero: string;
  intitule: string;
  type_compte: string;
  categorie: string | null;
  actif: boolean;
}

export interface BalanceComptable {
  compte_id: number;
  compte_numero: string;
  compte_intitule: string;
  total_debit: number;
  total_credit: number;
  solde: number;
}

export class GeneralLedgerService extends BaseService<EcritureComptableRecord> {
  protected tableName = 'ecritures_comptables';
  protected selectColumns = 'ec.id, ec.numero_piece, ec.date_ecriture, ec.journal, ec.piece_id, ec.piece_type, ec.ligne_numero, ec.compte_id, ec.debit, ec.credit, ec.description, ec.created_at, pc.numero as compte_numero, pc.intitule as compte_intitule';
  protected defaultSortColumn = 'date_ecriture';
  protected allowedSortColumns = ['date_ecriture', 'journal', 'numero_piece'];

  /**
   * Get all journal entries with pagination
   */
  async getAll(options?: { journal?: string; date_debut?: string; date_fin?: string; compte_id?: number; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ${this.selectColumns}
      FROM ecritures_comptables ec
      LEFT JOIN plan_comptable pc ON ec.compte_id = pc.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.journal) {
      query += ` AND ec.journal = $${params.length + 1}`;
      params.push(options.journal);
    }

    if (options?.date_debut) {
      query += ` AND ec.date_ecriture >= $${params.length + 1}::timestamp`;
      params.push(options.date_debut);
    }

    if (options?.date_fin) {
      query += ` AND ec.date_ecriture <= $${params.length + 1}::timestamp`;
      params.push(options.date_fin);
    }

    if (options?.compte_id) {
      query += ` AND ec.compte_id = $${params.length + 1}`;
      params.push(options.compte_id);
    }

    query += ' ORDER BY ec.date_ecriture DESC, ec.ligne_numero ASC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM ecritures_comptables ec WHERE 1=1`;
    const countParams: any[] = [];
    if (options?.journal) {
      countQuery += ` AND ec.journal = $${countParams.length + 1}`;
      countParams.push(options.journal);
    }
    if (options?.date_debut) {
      countQuery += ` AND ec.date_ecriture >= $${countParams.length + 1}::timestamp`;
      countParams.push(options.date_debut);
    }
    if (options?.date_fin) {
      countQuery += ` AND ec.date_ecriture <= $${countParams.length + 1}::timestamp`;
      countParams.push(options.date_fin);
    }
    if (options?.compte_id) {
      countQuery += ` AND ec.compte_id = $${countParams.length + 1}`;
      countParams.push(options.compte_id);
    }
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].total);

    return { data: rows, total };
  }

  /**
   * Get chart of accounts
   */
  async getChartOfAccounts(actifOnly: boolean = true): Promise<PlanComptableRecord[]> {
    let query = 'SELECT * FROM plan_comptable';
    const params: any[] = [];

    if (actifOnly) {
      query += ' WHERE actif = $1';
      params.push(true);
    }

    query += ' ORDER BY numero ASC';

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Get trial balance (Balance comptable)
   */
  async getTrialBalance(dateDebut: string, dateFin: string): Promise<BalanceComptable[]> {
    const { rows } = await pool.query(
      `SELECT 
        pc.id as compte_id,
        pc.numero as compte_numero,
        pc.intitule as compte_intitule,
        COALESCE(SUM(ec.debit), 0) as total_debit,
        COALESCE(SUM(ec.credit), 0) as total_credit,
        COALESCE(SUM(ec.debit), 0) - COALESCE(SUM(ec.credit), 0) as solde
       FROM plan_comptable pc
       LEFT JOIN ecritures_comptables ec ON pc.id = ec.compte_id 
         AND ec.date_ecriture BETWEEN $1::timestamp AND $2::timestamp
       WHERE pc.actif = true
       GROUP BY pc.id, pc.numero, pc.intitule
       HAVING COALESCE(SUM(ec.debit), 0) > 0 OR COALESCE(SUM(ec.credit), 0) > 0
       ORDER BY pc.numero ASC`,
      [dateDebut, dateFin]
    );
    return rows;
  }

  /**
   * Get account ledger (Grand livre d'un compte)
   */
  async getAccountLedger(compteId: number, dateDebut: string, dateFin: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT ec.*, pc.numero as compte_numero, pc.intitule as compte_intitule,
              SUM(ec.debit - ec.credit) OVER (ORDER BY ec.date_ecriture, ec.ligne_numero) as solde_cumule
       FROM ecritures_comptables ec
       JOIN plan_comptable pc ON ec.compte_id = pc.id
       WHERE ec.compte_id = $1 
         AND ec.date_ecriture BETWEEN $2::timestamp AND $3::timestamp
       ORDER BY ec.date_ecriture ASC, ec.ligne_numero ASC`,
      [compteId, dateDebut, dateFin]
    );
    return rows;
  }

  /**
   * Get journal entries by document reference
   */
  async getByDocument(pieceType: string, pieceId: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT ${this.selectColumns}
       FROM ecritures_comptables ec
       LEFT JOIN plan_comptable pc ON ec.compte_id = pc.id
       WHERE ec.piece_type = $1 AND ec.piece_id = $2
       ORDER BY ec.ligne_numero ASC`,
      [pieceType, pieceId]
    );
    return rows;
  }

  /**
   * Manual journal entry creation (for accountants)
   */
  async createManualEntry(
    numeroPiece: string,
    journal: string,
    dateEcriture: string,
    lignes: Array<{ compte_id: number; debit: number; credit: number; description?: string }>,
    userId?: number
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Validate balanced entry
      const totalDebit = lignes.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lignes.reduce((sum, l) => sum + l.credit, 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`L'écriture n'est pas équilibrée: Débit ${totalDebit} ≠ Crédit ${totalCredit}`);
      }

      // Guard against malformed payloads that would fail on NOT NULL/FK constraints.
      for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i];
        const compteId = Number((ligne as any).compte_id);
        const debit = Number((ligne as any).debit);
        const credit = Number((ligne as any).credit);

        if (!Number.isInteger(compteId) || compteId <= 0) {
          throw new Error(`Ligne ${i + 1}: compte_id invalide ou manquant`);
        }

        if (!Number.isFinite(debit) || debit < 0 || !Number.isFinite(credit) || credit < 0) {
          throw new Error(`Ligne ${i + 1}: débit/crédit invalide`);
        }

        if (debit === 0 && credit === 0) {
          throw new Error(`Ligne ${i + 1}: débit et crédit ne peuvent pas être tous les deux à zéro`);
        }
      }

      // Insert each line
      for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i];
        await client.query(
          `INSERT INTO ecritures_comptables 
           (numero_piece, date_ecriture, journal, ligne_numero, compte_id, debit, credit, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [numeroPiece, dateEcriture, journal, i + 1, ligne.compte_id, ligne.debit, ligne.credit, ligne.description || null]
        );
      }

      await client.query('COMMIT');

      logger.info({ numeroPiece, journal, lignes: lignes.length }, 'Manual journal entry created');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating manual journal entry');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get accounting statistics
   */
  async getStats(dateDebut?: string, dateFin?: string): Promise<any> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (dateDebut) {
      whereClause += ` AND date_ecriture >= $${params.length + 1}::timestamp`;
      params.push(dateDebut);
    }

    if (dateFin) {
      whereClause += ` AND date_ecriture <= $${params.length + 1}::timestamp`;
      params.push(dateFin);
    }

    const { rows } = await pool.query(
      `SELECT
        COUNT(*) as total_ecritures,
        COALESCE(SUM(debit), 0) as total_debit,
        COALESCE(SUM(credit), 0) as total_credit,
        COUNT(DISTINCT numero_piece) as total_pieces,
        COUNT(DISTINCT journal) as total_journaux
       FROM ecritures_comptables
       ${whereClause}`,
      params
    );
    return rows[0];
  }

  /**
   * Get journal breakdown by type
   */
  async getJournalBreakdown(dateDebut: string, dateFin: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT 
        journal,
        COUNT(*) as nombre_ecritures,
        COALESCE(SUM(debit), 0) as total_debit,
        COALESCE(SUM(credit), 0) as total_credit
       FROM ecritures_comptables
       WHERE date_ecriture BETWEEN $1::timestamp AND $2::timestamp
       GROUP BY journal
       ORDER BY journal ASC`,
      [dateDebut, dateFin]
    );
    return rows;
  }
}

export const generalLedgerService = new GeneralLedgerService();
