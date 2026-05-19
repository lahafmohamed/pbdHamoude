import pool from '../db/connection';
import { logAudit } from '../middleware/audit';

export class CaisseService {
  /**
   * Open a new cash register session
   */
  async openSession(utilisateurId: number, soldeOuverture: number, notes?: string): Promise<any> {
    const { rows } = await pool.query(
      `INSERT INTO sessions_caisse (utilisateur_id, solde_ouverture, notes_ouverture, statut)
       VALUES ($1, $2, $3, 'ouverte')
       RETURNING id, date_ouverture, solde_ouverture`,
      [utilisateurId, soldeOuverture, notes || null]
    );

    return rows[0];
  }

  /**
   * Close current session and calculate variance
   */
  async closeSession(sessionId: number, soldeFermeture: number, notes?: string): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get session details
      const { rows: sessionRows } = await client.query(
        'SELECT * FROM sessions_caisse WHERE id = $1 AND statut = $2',
        [sessionId, 'ouverte']
      );

      if (sessionRows.length === 0) {
        throw new Error('Session non trouvée ou déjà fermée');
      }

      const session = sessionRows[0];

      // Calculate theoretical cash total from all cash payments in this session
      const { rows: cashMovements } = await client.query(
        `SELECT COALESCE(SUM(montant), 0) as total_cash
         FROM mouvements_caisse
         WHERE session_id = $1 AND methode_paiement = 'espece'`,
        [sessionId]
      );

      const soldeTheorique = parseFloat(session.solde_ouverture) + parseFloat(cashMovements[0].total_cash);
      const ecart = soldeFermeture - soldeTheorique;

      // Update session
      await client.query(
        `UPDATE sessions_caisse 
         SET solde_fermeture = $1, solde_theorique = $2, ecart = $3, 
             notes_fermeture = $4, statut = 'fermee', date_fermeture = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [soldeFermeture, soldeTheorique, ecart, notes || null, sessionId]
      );

      await client.query('COMMIT');

      return {
        session_id: sessionId,
        solde_ouverture: session.solde_ouverture,
        solde_theorique: soldeTheorique.toFixed(2),
        solde_fermeture: soldeFermeture.toFixed(2),
        ecart: ecart.toFixed(2),
        message: ecart === 0 ? 'Session fermée - Trésorerie conforme' : `Session fermée - Écart: ${ecart.toFixed(2)} XOF`
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record a cash movement in current session
   */
  async recordMovement(sessionId: number, data: {
    montant: number;
    type_mouvement: string;
    methode_paiement?: string;
    facture_id?: number;
    description?: string;
    cree_par?: number;
  }): Promise<any> {
    const { rows } = await pool.query(
      `INSERT INTO mouvements_caisse (session_id, facture_id, montant, type_mouvement, methode_paiement, description, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, date_mouvement`,
      [sessionId, data.facture_id || null, data.montant, data.type_mouvement, data.methode_paiement || null, data.description || null, data.cree_par || null]
    );

    return rows[0];
  }

  /**
   * Get current open session for a user
   */
  async getCurrentSession(utilisateurId: number): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT * FROM sessions_caisse 
       WHERE utilisateur_id = $1 AND statut = 'ouverte'
       ORDER BY date_ouverture DESC
       LIMIT 1`,
      [utilisateurId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get Z report for a session (end-of-day report)
   */
  async getSessionZReport(sessionId: number): Promise<any> {
    // Session details
    const { rows: sessionRows } = await pool.query(
      'SELECT * FROM sessions_caisse WHERE id = $1',
      [sessionId]
    );

    if (sessionRows.length === 0) {
      throw new Error('Session non trouvée');
    }

    const session = sessionRows[0];

    // Cash movements summary
    const { rows: movementsByMethod } = await pool.query(
      `SELECT methode_paiement, COUNT(*) as nombre, SUM(montant) as total
       FROM mouvements_caisse
       WHERE session_id = $1 AND methode_paiement IS NOT NULL
       GROUP BY methode_paiement`,
      [sessionId]
    );

    // Total sales
    const { rows: salesTotal } = await pool.query(
      `SELECT COUNT(*) as nombre_ventes, COALESCE(SUM(montant), 0) as total_ventes
       FROM mouvements_caisse
       WHERE session_id = $1 AND type_mouvement = 'vente'`,
      [sessionId]
    );

    // Other movements
    const { rows: otherMovements } = await pool.query(
      `SELECT type_mouvement, COUNT(*) as nombre, SUM(montant) as total
       FROM mouvements_caisse
       WHERE session_id = $1 AND type_mouvement != 'vente'
       GROUP BY type_mouvement`,
      [sessionId]
    );

    return {
      session: {
        ...session,
        solde_ouverture: parseFloat(session.solde_ouverture),
        solde_theorique: session.solde_theorique ? parseFloat(session.solde_theorique) : null,
        solde_fermeture: session.solde_fermeture ? parseFloat(session.solde_fermeture) : null,
        ecart: session.ecart ? parseFloat(session.ecart) : null,
      },
      ventes: salesTotal[0],
      par_methode_paiement: movementsByMethod,
      autres_mouvements: otherMovements,
    };
  }

/**
    * Get sessions list with pagination
    */
  async getSessions(page: number = 1, limit: number = 20, utilisateurId?: number, statut?: string): Promise<any> {
    const offset = (page - 1) * limit;
    let query = `
      SELECT s.*, u.username as utilisateur_nom
      FROM sessions_caisse s
      LEFT JOIN utilisateurs u ON s.utilisateur_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (utilisateurId) {
      query += ' AND s.utilisateur_id = $' + (params.length + 1);
      params.push(utilisateurId);
    }

    if (statut) {
      query += ' AND s.statut = $' + (params.length + 1);
      params.push(statut);
    }

    query += ' ORDER BY s.date_ouverture DESC';
    query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Count
    let countQuery = 'SELECT COUNT(*) FROM sessions_caisse WHERE 1=1';
    const countParams: any[] = [];
    if (utilisateurId) {
      countQuery += ' AND utilisateur_id = $1';
      countParams.push(utilisateurId);
    }
    if (statut) {
      countQuery += countParams.length > 0 ? ' AND statut = $2' : ' AND statut = $1';
      countParams.push(statut);
    }

    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].count);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      }
    };
  }

/**
   * Get all payments for a cash register session (today)
   */
  async getSessionPaiements(sessionId: number): Promise<any> {
    try {
      // Try with session_caisse_id first
      const { rows } = await pool.query(
        `SELECT p.*, f.numero_facture, t.raison_sociale as client_nom, t.prenom as client_prenom
         FROM paiements p
         LEFT JOIN factures f ON p.facture_id = f.id
         LEFT JOIN tiers t ON f.tiers_id = t.id
         WHERE p.session_caisse_id = $1
         ORDER BY p.date_paiement DESC`,
        [sessionId]
      );
      // If empty, get today's payments
      if (rows.length === 0) {
        const { rows: todayRows } = await pool.query(
          `SELECT p.*, f.numero_facture, t.raison_sociale as client_nom, t.prenom as client_prenom
           FROM paiements p
           LEFT JOIN factures f ON p.facture_id = f.id
           LEFT JOIN tiers t ON f.tiers_id = t.id
           WHERE p.date_paiement >= CURRENT_DATE
           ORDER BY p.date_paiement DESC`
        );
        return todayRows;
      }
      return rows;
    } catch (error) {
      // Fallback to today's payments
      const { rows } = await pool.query(
        `SELECT p.*, f.numero_facture, t.raison_sociale as client_nom, t.prenom as client_prenom
         FROM paiements p
         LEFT JOIN factures f ON p.facture_id = f.id
         LEFT JOIN tiers t ON f.tiers_id = t.id
         WHERE p.date_paiement >= CURRENT_DATE
         ORDER BY p.date_paiement DESC`
      );
      return rows;
    }
  }
}

export const caisseService = new CaisseService();
