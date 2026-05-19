import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface CreateSessionInput {
  magasin_id: number;
  fond_initial: number;
  commentaire_ouverture?: string;
  user_id: number;
}

export interface CloseSessionInput {
  session_id: number;
  fond_final_compte: number;
  commentaire_cloture?: string;
  user_id: number;
}

export interface CreateMouvementInput {
  session_caisse_id: number;
  type: 'encaissement' | 'decaissement';
  categorie: string;
  montant: number;
  methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement' | 'mobile_money' | 'orange_money' | 'mtn_money' | 'wave';
  reference_type?: string;
  reference_id?: number;
  libelle: string;
  user_id?: number;
  idempotency_key?: string;
}

export class CaisseMagasinService {
  /**
   * Get current open session for a magasin
   */
  async getSessionActive(magasinId: number): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT s.*, 
              m.nom as magasin_nom, m.code as magasin_code,
              ouv.username as ouvert_par_username,
              fer.username as cloture_par_username
       FROM sessions_caisse s
       JOIN magasins m ON s.magasin_id = m.id
       LEFT JOIN utilisateurs ouv ON s.ouverte_par_user_id = ouv.id
       LEFT JOIN utilisateurs fer ON s.cloturee_par_user_id = fer.id
       WHERE s.magasin_id = $1 AND s.statut = 'ouverte'
       LIMIT 1`,
      [magasinId]
    );

    if (rows.length === 0) return null;
    
    // Calculate current balance
    const session = rows[0];
    const { rows: mouvements } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'encaissement' THEN montant ELSE 0 END), 0) as total_encaissements,
              COALESCE(SUM(CASE WHEN type = 'decaissement' THEN montant ELSE 0 END), 0) as total_decaissements
       FROM mouvements_caisse
       WHERE session_caisse_id = $1`,
      [session.id]
    );

    const fondInitial = parseFloat(session.fond_initial) || 0;
    const encaissements = parseFloat(mouvements[0].total_encaissements) || 0;
    const decaissements = parseFloat(mouvements[0].total_decaissements) || 0;
    const soldeTheorique = fondInitial + encaissements - decaissements;

    return {
      ...session,
      fond_initial: fondInitial,
      total_encaissements: encaissements,
      total_decaissements: decaissements,
      solde_theorique: soldeTheorique,
    };
  }

  /**
   * Get user location role
   */
  async getUserMagasinRole(userId: number, magasinId: number): Promise<'magasin_staff' | 'admin' | 'none'> {
    // Check if admin
    const { rows: userRows } = await pool.query(
      'SELECT r.nom AS role FROM utilisateurs u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = $1',
      [userId]
    );
    
    if (userRows.length === 0) return 'none';
    const userRole = userRows[0].role;
    
    if (userRole === 'admin') return 'admin';
    
    // Check user_location_roles (graceful fallback if table missing)
    try {
      const { rows } = await pool.query(
        `SELECT role_at_location FROM user_location_roles
         WHERE utilisateur_id = $1
         AND location_id = (SELECT location_id FROM magasins WHERE id = $2)`,
        [userId, magasinId]
      );

      if (rows.length > 0 && ['magasin_staff', 'both'].includes(rows[0].role_at_location)) {
        return 'magasin_staff';
      }
    } catch (err: any) {
      // Table probably missing — log and fall through to legacy check
      logger.warn({ err: err.message }, 'user_location_roles query failed, falling back');
    }

    // Fallback: check utilisateur_locations
    const { rows: fallbackRows } = await pool.query(
      `SELECT ul.location_id 
       FROM utilisateur_locations ul
       JOIN magasins m ON m.location_id = ul.location_id
       WHERE ul.utilisateur_id = $1 AND m.id = $2`,
      [userId, magasinId]
    );

    if (fallbackRows.length > 0) {
      // Check if user has magasin_staff role
      if (userRole === 'magasin_staff' || userRole === 'caissier') return 'magasin_staff';
    }

    return 'none';
  }

  /**
   * Open a new cash register session
   */
  async ouvrirSession(input: CreateSessionInput): Promise<any> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Check if user can access this magasin
      const userRole = await this.getUserMagasinRole(input.user_id, input.magasin_id);
      if (userRole === 'none') {
        throw new Error('Accès refusé - vous ne pouvez pas ouvrir la caisse de ce magasin');
      }

      // Check if a session is already open for this magasin
      const { rows: existingRows } = await client.query(
        'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2',
        [input.magasin_id, 'ouverte']
      );

      if (existingRows.length > 0) {
        throw new Error('Une session est déjà ouverte pour ce magasin. Veuillez la clôturer avant d\'ouvrir une nouvelle session.');
      }

      // Create session
      const { rows } = await client.query(
        `INSERT INTO sessions_caisse (
          magasin_id, ouverte_par_user_id, fond_initial, 
          commentaire_ouverture, statut, date_ouverture
        ) VALUES ($1, $2, $3, $4, 'ouverte', CURRENT_TIMESTAMP)
        RETURNING id, magasin_id, fond_initial, date_ouverture, statut`,
        [
          input.magasin_id,
          input.user_id,
          input.fond_initial,
          input.commentaire_ouverture || null
        ]
      );

      await client.query('COMMIT');

      // Audit log
      await logAudit({
        utilisateur_id: input.user_id,
        action: 'create',
        table_name: 'sessions_caisse',
        record_id: rows[0].id,
        new_values: { magasin_id: input.magasin_id, fond_initial: input.fond_initial },
      });

      logger.info({ sessionId: rows[0].id, magasinId: input.magasin_id }, 'Session caisse ouverte');

      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Build day-close preview without committing.
   * Returns expected_cash, per-method totals, orphan list, current variance.
   */
  async getCloturePreview(sessionId: number, fondFinalCompte?: number): Promise<any> {
    const { rows: sessRows } = await pool.query(
      `SELECT * FROM sessions_caisse WHERE id = $1`,
      [sessionId]
    );
    if (sessRows.length === 0) throw new Error('Session introuvable');
    const session = sessRows[0];

    // Per-method breakdown
    const { rows: byMethod } = await pool.query(
      `SELECT methode_paiement,
              COALESCE(SUM(CASE WHEN type = 'encaissement' THEN montant ELSE 0 END), 0) AS total_encaissements,
              COALESCE(SUM(CASE WHEN type = 'decaissement' THEN montant ELSE 0 END), 0) AS total_decaissements,
              COUNT(*) AS nb
       FROM mouvements_caisse
       WHERE session_caisse_id = $1
       GROUP BY methode_paiement`,
      [sessionId]
    );

    // Orphans: lines without source link AND not in divers categories
    const { rows: orphans } = await pool.query(
      `SELECT id, type, categorie, montant, libelle, date_mouvement
       FROM mouvements_caisse
       WHERE session_caisse_id = $1
         AND (reference_type IS NULL OR reference_id IS NULL)
         AND categorie NOT IN ('apport','retrait_banque','autre_entree','autre_sortie')`,
      [sessionId]
    );

    const fondInitial = parseFloat(session.fond_initial) || 0;
    const cashRow = byMethod.find((r: any) => r.methode_paiement === 'espece');
    const cashEnc = cashRow ? parseFloat(cashRow.total_encaissements) : 0;
    const cashDec = cashRow ? parseFloat(cashRow.total_decaissements) : 0;
    const expectedCash = fondInitial + cashEnc - cashDec;

    let ecart: number | null = null;
    if (fondFinalCompte !== undefined && fondFinalCompte !== null) {
      ecart = fondFinalCompte - expectedCash;
    }

    return {
      session_id: sessionId,
      magasin_id: session.magasin_id,
      statut: session.statut,
      fond_initial: fondInitial,
      expected_cash: expectedCash,
      fond_final_compte: fondFinalCompte ?? null,
      ecart,
      par_methode: byMethod.map((r: any) => ({
        methode_paiement: r.methode_paiement,
        total_encaissements: parseFloat(r.total_encaissements),
        total_decaissements: parseFloat(r.total_decaissements),
        nb: parseInt(r.nb),
      })),
      orphan_mouvements: orphans,
      can_close: orphans.length === 0,
    };
  }

  /**
   * Close a cash register session.
   * Refuses if orphan caisse lines exist. Variance computed against cash only.
   */
  async cloturerSession(input: CloseSessionInput): Promise<any> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: sessionRows } = await client.query(
        `SELECT * FROM sessions_caisse WHERE id = $1 AND statut = 'ouverte' FOR UPDATE`,
        [input.session_id]
      );

      if (sessionRows.length === 0) {
        throw new Error('Session non trouvée ou déjà clôturée');
      }

      const session = sessionRows[0];

      const userRole = await this.getUserMagasinRole(input.user_id, session.magasin_id);
      if (userRole === 'none') {
        throw new Error('Accès refusé - vous ne pouvez pas clôturer cette caisse');
      }

      // Refuse if orphan lines exist
      const { rows: orphans } = await client.query(
        `SELECT id FROM mouvements_caisse
         WHERE session_caisse_id = $1
           AND (reference_type IS NULL OR reference_id IS NULL)
           AND categorie NOT IN ('apport','retrait_banque','autre_entree','autre_sortie')`,
        [input.session_id]
      );
      if (orphans.length > 0) {
        throw new Error(`Clôture impossible: ${orphans.length} mouvement(s) sans source. Régularisez avant clôture.`);
      }

      // Per-method totals
      const { rows: byMethod } = await client.query(
        `SELECT methode_paiement,
                COALESCE(SUM(CASE WHEN type = 'encaissement' THEN montant ELSE 0 END), 0) AS total_encaissements,
                COALESCE(SUM(CASE WHEN type = 'decaissement' THEN montant ELSE 0 END), 0) AS total_decaissements
         FROM mouvements_caisse
         WHERE session_caisse_id = $1
         GROUP BY methode_paiement`,
        [input.session_id]
      );

      const totauxParMethode: Record<string, { in: number; out: number }> = {};
      let totalEnc = 0;
      let totalDec = 0;
      for (const r of byMethod) {
        const inAmt = parseFloat(r.total_encaissements);
        const outAmt = parseFloat(r.total_decaissements);
        totauxParMethode[r.methode_paiement] = { in: inAmt, out: outAmt };
        totalEnc += inAmt;
        totalDec += outAmt;
      }

      const fondInitial = parseFloat(session.fond_initial) || 0;
      const cash = totauxParMethode['espece'] || { in: 0, out: 0 };
      const expectedCash = fondInitial + cash.in - cash.out;
      const soldeTheorique = fondInitial + totalEnc - totalDec; // legacy field
      const ecart = Number((input.fond_final_compte - expectedCash).toFixed(2));

      if (ecart !== 0 && (!input.commentaire_cloture || input.commentaire_cloture.trim() === '')) {
        throw new Error(`Écart de ${ecart.toFixed(0)} FCFA détecté. Un commentaire est obligatoire pour expliquer l'écart.`);
      }

      const { rows } = await client.query(
        `UPDATE sessions_caisse
         SET statut = 'cloturee',
             cloturee_par_user_id = $1,
             date_cloture = CURRENT_TIMESTAMP,
             fond_final_compte = $2,
             solde_theorique_cloture = $3,
             ecart = $4,
             commentaire_cloture = $5,
             expected_cash = $6,
             totaux_par_methode = $7::jsonb
         WHERE id = $8
         RETURNING id, fond_initial, fond_final_compte, expected_cash, solde_theorique_cloture, ecart, statut, totaux_par_methode`,
        [
          input.user_id,
          input.fond_final_compte,
          soldeTheorique,
          ecart,
          input.commentaire_cloture || null,
          expectedCash,
          JSON.stringify(totauxParMethode),
          input.session_id,
        ]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: input.user_id,
        action: 'update',
        table_name: 'sessions_caisse',
        record_id: input.session_id,
        new_values: { statut: 'cloturee', ecart, fond_final_compte: input.fond_final_compte },
      });

      logger.info({ sessionId: input.session_id, ecart, expectedCash }, 'Session caisse clôturée');

      return {
        ...rows[0],
        total_encaissements: totalEnc,
        total_decaissements: totalDec,
        expected_cash: expectedCash,
        par_methode: totauxParMethode,
        message: ecart === 0
          ? 'Session clôturée - Caisse conforme'
          : `Session clôturée - Écart espèces: ${ecart.toFixed(0)} FCFA`,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a cash movement (called by other services)
   * Must be called within a transaction
   */
  async enregistrerMouvement(
    client: any,
    input: CreateMouvementInput
  ): Promise<any> {
    if (!input.montant || input.montant <= 0) {
      throw new Error('Montant doit être > 0');
    }
    if (!input.methode_paiement) {
      throw new Error('methode_paiement obligatoire');
    }

    // Idempotency short-circuit
    if (input.idempotency_key) {
      const { rows: existing } = await client.query(
        'SELECT id, session_caisse_id, type, categorie, montant, solde_apres FROM mouvements_caisse WHERE idempotency_key = $1',
        [input.idempotency_key]
      );
      if (existing.length > 0) return existing[0];
    }

    // Lock session row to serialize concurrent inserts within same session
    const { rows: sessionRows } = await client.query(
      'SELECT id, magasin_id, fond_initial, statut FROM sessions_caisse WHERE id = $1 FOR UPDATE',
      [input.session_caisse_id]
    );

    if (sessionRows.length === 0) {
      throw new Error('Session de caisse non trouvée');
    }

    const session = sessionRows[0];
    if (session.statut !== 'ouverte') {
      throw new Error('Caisse fermée — ouvrez la caisse du magasin avant d\'enregistrer cette transaction.');
    }

    // Source-link enforcement at app layer (DB CHECK is the backstop)
    const dversCategories = ['apport', 'retrait_banque', 'autre_entree', 'autre_sortie'];
    if (input.reference_type == null || input.reference_id == null) {
      if (!dversCategories.includes(input.categorie)) {
        throw new Error(`Mouvement caisse sans source: categorie '${input.categorie}' exige reference_type+reference_id`);
      }
    }

    // Compute running balance (now safe under FOR UPDATE)
    const { rows: currentMouvements } = await client.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'encaissement' THEN montant ELSE -montant END), 0) as balance_change
       FROM mouvements_caisse
       WHERE session_caisse_id = $1`,
      [input.session_caisse_id]
    );

    const fondInitial = parseFloat(session.fond_initial) || 0;
    const currentChange = parseFloat(currentMouvements[0].balance_change) || 0;
    const thisChange = input.type === 'encaissement' ? input.montant : -input.montant;
    const soldeApres = fondInitial + currentChange + thisChange;

    const { rows } = await client.query(
      `INSERT INTO mouvements_caisse (
        session_caisse_id, date_mouvement, type, categorie,
        montant, methode_paiement, reference_type, reference_id,
        libelle, solde_apres, cree_par, magasin_id, idempotency_key
      ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, session_caisse_id, type, categorie, montant, methode_paiement, solde_apres, magasin_id`,
      [
        input.session_caisse_id,
        input.type,
        input.categorie,
        input.montant,
        input.methode_paiement,
        input.reference_type || null,
        input.reference_id || null,
        input.libelle,
        soldeApres,
        input.user_id || null,
        session.magasin_id,
        input.idempotency_key || null,
      ]
    );

    return rows[0];
  }

  /**
   * Get all movements for a session
   */
  async getMouvementsSession(sessionId: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT m.*,
              u.username as cree_par_username
       FROM mouvements_caisse m
       LEFT JOIN utilisateurs u ON m.cree_par = u.id
       WHERE m.session_caisse_id = $1
       ORDER BY m.date_mouvement ASC`,
      [sessionId]
    );
    return rows;
  }

  /**
   * Get session details with all movements
   */
  async getSessionDetail(sessionId: number): Promise<any> {
    // Get session
    const { rows: sessionRows } = await pool.query(
      `SELECT s.*, 
              m.nom as magasin_nom, m.code as magasin_code,
              ouv.username as ouvert_par_username,
              fer.username as cloture_par_username
       FROM sessions_caisse s
       JOIN magasins m ON s.magasin_id = m.id
       LEFT JOIN utilisateurs ouv ON s.ouverte_par_user_id = ouv.id
       LEFT JOIN utilisateurs fer ON s.cloturee_par_user_id = fer.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      throw new Error('Session non trouvée');
    }

    const session = sessionRows[0];

    // Get movements
    const mouvements = await this.getMouvementsSession(sessionId);

    // Calculate totals
    const encaissements = mouvements
      .filter(m => m.type === 'encaissement')
      .reduce((sum, m) => sum + parseFloat(m.montant), 0);
    
    const decaissements = mouvements
      .filter(m => m.type === 'decaissement')
      .reduce((sum, m) => sum + parseFloat(m.montant), 0);

    const fondInitial = parseFloat(session.fond_initial) || 0;
    const soldeTheorique = fondInitial + encaissements - decaissements;

    return {
      ...session,
      fond_initial: fondInitial,
      total_encaissements: encaissements,
      total_decaissements: decaissements,
      solde_theorique: soldeTheorique,
      mouvements: mouvements.map(m => ({
        ...m,
        montant: parseFloat(m.montant),
        solde_apres: parseFloat(m.solde_apres),
      }))
    };
  }

  /**
   * Get list of magasins for a user
   */
  async getMagasinsForUser(userId: number, userRole: string): Promise<any[]> {
    // For now, show all active magasins to all authenticated users
    // In production, you might want to filter by user assignments
    const { rows } = await pool.query(
      `SELECT m.*, sl.nom as location_nom
       FROM magasins m
       LEFT JOIN stock_locations sl ON m.location_id = sl.id
       WHERE m.actif = true
       ORDER BY m.code`
    );
    return rows;
  }

  /**
   * Get historique des sessions clôturées
   */
  async getHistoriqueSessions(
    magasinId?: number,
    dateDebut?: string,
    dateFin?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE s.statut = $1';
    const params: any[] = ['cloturee'];
    let paramIndex = 2;

    if (magasinId) {
      whereClause += ` AND s.magasin_id = $${paramIndex++}`;
      params.push(magasinId);
    }

    if (dateDebut) {
      whereClause += ` AND s.date_ouverture >= $${paramIndex++}`;
      params.push(dateDebut);
    }

    if (dateFin) {
      whereClause += ` AND s.date_ouverture <= $${paramIndex++}`;
      params.push(dateFin);
    }

    const query = `
      SELECT s.*, 
             m.nom as magasin_nom, m.code as magasin_code,
             ouv.username as ouvert_par_username,
             fer.username as cloture_par_username
      FROM sessions_caisse s
      JOIN magasins m ON s.magasin_id = m.id
      LEFT JOIN utilisateurs ouv ON s.ouverte_par_user_id = ouv.id
      LEFT JOIN utilisateurs fer ON s.cloturee_par_user_id = fer.id
      ${whereClause}
      ORDER BY s.date_ouverture DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Count total
    let countQuery = `SELECT COUNT(*) FROM sessions_caisse s ${whereClause}`;
    const countParams = params.slice(0, -2); // Remove limit/offset
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].count);

    return {
      data: rows.map(r => ({
        ...r,
        fond_initial: parseFloat(r.fond_initial),
        fond_final_compte: r.fond_final_compte ? parseFloat(r.fond_final_compte) : null,
        solde_theorique_cloture: r.solde_theorique_cloture ? parseFloat(r.solde_theorique_cloture) : null,
        ecart: r.ecart ? parseFloat(r.ecart) : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

export const caisseMagasinService = new CaisseMagasinService();
