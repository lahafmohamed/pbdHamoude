import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { caisseMagasinService } from './CaisseMagasinService';

export interface CreateDepenseInputV2 {
  magasin_id: number;
  categorie_id: number;
  montant: number;
  methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement' | 'mobile_money';
  date_depense?: string;
  description: string;
  beneficiaire_libre?: string;
  fournisseur_id?: number;
  justificatif_url?: string;
  cree_par?: number;
  req?: any;
}

export interface UpdateDepenseInputV2 {
  categorie_id?: number;
  montant?: number;
  methode_paiement?: 'espece' | 'carte' | 'cheque' | 'virement' | 'mobile_money';
  date_depense?: string;
  description?: string;
  beneficiaire_libre?: string;
  fournisseur_id?: number;
  justificatif_url?: string;
  modifie_par?: number;
}

export class DepenseServiceV2 {
  /**
   * Check if user can create expense at this magasin
   */
  async canAccessMagasin(userId: number, userRole: string, magasinId: number): Promise<boolean> {
    if (userRole === 'admin') return true;
    
    const role = await caisseMagasinService.getUserMagasinRole(userId, magasinId);
    return role !== 'none';
  }

  /**
   * Create a new expense with cash register integration
   */
  async create(input: CreateDepenseInputV2): Promise<{ id: number; numero_depense: string; mouvement_caisse_id?: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { 
        magasin_id, categorie_id, montant, methode_paiement,
        date_depense, description, beneficiaire_libre, fournisseur_id,
        justificatif_url, cree_par 
      } = input;

      // Verify category exists
      const { rows: catRows } = await client.query(
        'SELECT id, nom FROM categories_depenses WHERE id = $1 AND actif = true',
        [categorie_id]
      );

      if (catRows.length === 0) {
        throw new Error('Catégorie de dépense invalide');
      }
      const categorieNom = catRows[0].nom;

      // Generate expense number
      const { rows: seqRows } = await client.query("SELECT nextval('depense_seq') as num");
      const numeroDepense = `DEP-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      let sessionCaisseId: number | null = null;
      let mouvementCaisseId: number | null = null;

      // If cash payment, verify cash register is open (check only, movement created after)
      if (methode_paiement === 'espece') {
        const session = await caisseMagasinService.getSessionActive(magasin_id);
        if (!session) {
          throw new Error('Caisse fermée — ouvrez la caisse du magasin avant d\'enregistrer cette dépense.');
        }
        sessionCaisseId = session.id;
      }

      // Insert expense first to get its real ID
      const { rows: depResult } = await client.query(
        `INSERT INTO depenses (
          numero_depense, magasin_id, session_caisse_id, mouvement_caisse_id,
          categorie_id, montant, methode_paiement, date_depense, description,
          beneficiaire_libre, tiers_id, justificatif_url, cree_par
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          numeroDepense, magasin_id, sessionCaisseId, null,
          categorie_id, montant, methode_paiement,
          date_depense || new Date().toISOString().split('T')[0],
          description, beneficiaire_libre || null, fournisseur_id || null,
          justificatif_url || null, cree_par || null
        ]
      );

      const depenseId = depResult[0].id;

      // Now create cash movement with the real depenseId as reference
      if (methode_paiement === 'espece' && sessionCaisseId) {
        const mouvement = await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: sessionCaisseId,
          type: 'decaissement',
          categorie: 'depense',
          montant,
          methode_paiement: 'espece',
          reference_type: 'depense',
          reference_id: depenseId,
          libelle: `Dépense ${numeroDepense} - ${categorieNom}`,
          user_id: cree_par
        });

        mouvementCaisseId = mouvement.id;

        // Link the movement back to the expense
        await client.query(
          'UPDATE depenses SET mouvement_caisse_id = $1 WHERE id = $2',
          [mouvementCaisseId, depenseId]
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'depenses',
          record_id: depenseId,
          req: input.req,
          new_values: { numero_depense: numeroDepense, montant, categorie_id, magasin_id },
        });
      }

      logger.info({ depenseId, numeroDepense, mouvementCaisseId }, 'Dépense créée');
      
      return { 
        id: depenseId, 
        numero_depense: numeroDepense,
        mouvement_caisse_id: mouvementCaisseId || undefined
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update expense (only allowed if session still open)
   */
  async update(id: number, input: UpdateDepenseInputV2, userId: number, userRole: string): Promise<{ id: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if expense exists and is editable
      const { rows: existingRows } = await client.query(
        `SELECT d.*, s.statut as session_statut 
         FROM depenses d
         LEFT JOIN sessions_caisse s ON d.session_caisse_id = s.id
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('Dépense non trouvée');
      }

      const existing = existingRows[0];

      // Check permission
      const canAccess = await this.canAccessMagasin(userId, userRole, existing.magasin_id);
      if (!canAccess) {
        throw new Error('Accès refusé - vous ne pouvez pas modifier cette dépense');
      }

      // If linked to closed session, reject
      if (existing.session_statut === 'cloturee') {
        throw new Error('Cette dépense est dans une session clôturée - modification impossible.');
      }

      // Check if amount or payment method changed for cash expenses
      const oldMontant = parseFloat(existing.montant);
      const oldMethode = existing.methode_paiement;
      const newMontant = input.montant !== undefined ? input.montant : oldMontant;
      const newMethode = input.methode_paiement || oldMethode;

      // Handle cash payment changes
      if (oldMethode === 'espece' && newMethode === 'espece') {
        // Still cash, check if amount changed
        if (input.montant !== undefined && input.montant !== oldMontant) {
          // Create reverse movement for old amount
          await caisseMagasinService.enregistrerMouvement(client, {
            session_caisse_id: existing.session_caisse_id,
            type: 'encaissement', // Reverse = credit
            categorie: 'depense',
            montant: oldMontant,
            methode_paiement: 'espece',
            reference_type: 'depense',
            reference_id: id,
            libelle: `Correction dépense ${existing.numero_depense} - ancien montant`,
            user_id: input.modifie_par
          });

          // Create new movement for new amount
          const newMouvement = await caisseMagasinService.enregistrerMouvement(client, {
            session_caisse_id: existing.session_caisse_id,
            type: 'decaissement',
            categorie: 'depense',
            montant: newMontant,
            methode_paiement: 'espece',
            reference_type: 'depense',
            reference_id: id,
            libelle: `Dépense ${existing.numero_depense} - montant corrigé`,
            user_id: input.modifie_par
          });

          // Update mouvement_caisse_id link
          await client.query(
            'UPDATE depenses SET mouvement_caisse_id = $1 WHERE id = $2',
            [newMouvement.id, id]
          );
        }
      } else if (oldMethode === 'espece' && newMethode !== 'espece') {
        // Changed from cash to non-cash: reverse the cash movement
        await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: existing.session_caisse_id,
          type: 'encaissement',
          categorie: 'depense',
          montant: oldMontant,
          methode_paiement: 'espece',
          reference_type: 'depense',
          reference_id: id,
          libelle: `Annulation caisse - dépense ${existing.numero_depense} passée en ${newMethode}`,
          user_id: input.modifie_par
        });

        // Clear caisse links
        await client.query(
          'UPDATE depenses SET session_caisse_id = NULL, mouvement_caisse_id = NULL WHERE id = $1',
          [id]
        );
      } else if (oldMethode !== 'espece' && newMethode === 'espece') {
        // Changed from non-cash to cash: check caisse is open
        const session = await caisseMagasinService.getSessionActive(existing.magasin_id);
        if (!session) {
          throw new Error('Caisse fermée — impossible de passer cette dépense en espèces.');
        }

        const newMouvement = await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: session.id,
          type: 'decaissement',
          categorie: 'depense',
          montant: newMontant,
          methode_paiement: 'espece',
          reference_type: 'depense',
          reference_id: id,
          libelle: `Dépense ${existing.numero_depense} - mode de paiement changé en espèces`,
          user_id: input.modifie_par
        });

        // Update caisse links
        await client.query(
          'UPDATE depenses SET session_caisse_id = $1, mouvement_caisse_id = $2 WHERE id = $3',
          [session.id, newMouvement.id, id]
        );
      }

      // Build update query
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (input.categorie_id !== undefined) {
        params.push(input.categorie_id);
        updates.push(`categorie_id = $${paramIndex++}`);
      }
      if (input.montant !== undefined) {
        params.push(input.montant);
        updates.push(`montant = $${paramIndex++}`);
      }
      if (input.methode_paiement !== undefined) {
        params.push(input.methode_paiement);
        updates.push(`methode_paiement = $${paramIndex++}`);
      }
      if (input.date_depense !== undefined) {
        params.push(input.date_depense);
        updates.push(`date_depense = $${paramIndex++}`);
      }
      if (input.description !== undefined) {
        params.push(input.description);
        updates.push(`description = $${paramIndex++}`);
      }
      if (input.beneficiaire_libre !== undefined) {
        params.push(input.beneficiaire_libre);
        updates.push(`beneficiaire_libre = $${paramIndex++}`);
      }
      if (input.fournisseur_id !== undefined) {
        params.push(input.fournisseur_id);
        updates.push(`tiers_id = $${paramIndex++}`);
      }
      if (input.justificatif_url !== undefined) {
        params.push(input.justificatif_url);
        updates.push(`justificatif_url = $${paramIndex++}`);
      }

      if (updates.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE depenses SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
          params
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (input.modifie_par) {
        await logAudit({
          utilisateur_id: input.modifie_par,
          action: 'update',
          table_name: 'depenses',
          record_id: id,
          new_values: input,
        });
      }

      logger.info({ depenseId: id }, 'Dépense mise à jour');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error updating expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete expense (soft delete with reverse movement if cash)
   */
  async delete(id: number, userId: number, userRole: string, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get expense
      const { rows } = await client.query(
        `SELECT d.*, s.statut as session_statut 
         FROM depenses d
         LEFT JOIN sessions_caisse s ON d.session_caisse_id = s.id
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [id]
      );

      if (rows.length === 0) {
        throw new Error('Dépense non trouvée');
      }

      const expense = rows[0];

      // Check permission
      const canAccess = await this.canAccessMagasin(userId, userRole, expense.magasin_id);
      if (!canAccess) {
        throw new Error('Accès refusé - vous ne pouvez pas supprimer cette dépense');
      }

      // Check if linked to closed session
      if (expense.session_statut === 'cloturee') {
        throw new Error('Cette dépense est dans une session clôturée - suppression impossible.');
      }

      // If cash expense, create reverse movement
      if (expense.methode_paiement === 'espece' && expense.session_caisse_id) {
        await caisseMagasinService.enregistrerMouvement(client, {
          session_caisse_id: expense.session_caisse_id,
          type: 'encaissement', // Reverse the decaissement
          categorie: 'depense',
          montant: parseFloat(expense.montant),
          methode_paiement: 'espece',
          reference_type: 'depense',
          reference_id: id,
          libelle: `Annulation dépense ${expense.numero_depense}`,
          user_id: userId
        });
      }

      // Soft delete
      await client.query(
        'UPDATE depenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );

      await client.query('COMMIT');

      // Audit log
      await logAudit({
        utilisateur_id: userId,
        action: 'delete',
        table_name: 'depenses',
        record_id: id,
        req,
      });

      logger.info({ depenseId: id }, 'Dépense supprimée');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error deleting expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get expense with full details
   */
  async getById(id: number): Promise<any> {
    const { rows } = await pool.query(
      `SELECT d.*, 
              cd.nom as categorie_nom, cd.code as categorie_code,
              m.nom as magasin_nom, m.code as magasin_code,
              t.raison_sociale as fournisseur_nom,
              sc.numero_session,
              u.nom as createur_nom,
              mc.date_mouvement as date_mouvement_caisse,
              mc.solde_apres as solde_caisse_apres
       FROM depenses d
       LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
       LEFT JOIN magasins m ON d.magasin_id = m.id
       LEFT JOIN tiers t ON d.tiers_id = t.id
       LEFT JOIN sessions_caisse sc ON d.session_caisse_id = sc.id
       LEFT JOIN utilisateurs u ON d.cree_par = u.id
       LEFT JOIN mouvements_caisse mc ON d.mouvement_caisse_id = mc.id
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [id]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * List expenses with filters
   */
  async getAll(filters: {
    magasin_id?: number;
    categorie_id?: number;
    methode_paiement?: string;
    date_debut?: string;
    date_fin?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const { 
      magasin_id, categorie_id, methode_paiement, 
      date_debut, date_fin, search,
      page = 1, limit = 20 
    } = filters;
    
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE d.deleted_at IS NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (magasin_id) {
      whereClause += ` AND d.magasin_id = $${paramIndex++}`;
      params.push(magasin_id);
    }

    if (categorie_id) {
      whereClause += ` AND d.categorie_id = $${paramIndex++}`;
      params.push(categorie_id);
    }

    if (methode_paiement) {
      whereClause += ` AND d.methode_paiement = $${paramIndex++}`;
      params.push(methode_paiement);
    }

    if (date_debut) {
      whereClause += ` AND d.date_depense >= $${paramIndex++}`;
      params.push(date_debut);
    }

    if (date_fin) {
      whereClause += ` AND d.date_depense <= $${paramIndex++}`;
      params.push(date_fin);
    }

    if (search) {
      whereClause += ` AND (d.numero_depense ILIKE $${paramIndex++} OR d.description ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const query = `
      SELECT d.*, 
             cd.nom as categorie_nom,
             m.nom as magasin_nom, m.code as magasin_code,
             t.raison_sociale as fournisseur_nom,
             u.username as createur_username
      FROM depenses d
      LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
      LEFT JOIN magasins m ON d.magasin_id = m.id
      LEFT JOIN tiers t ON d.tiers_id = t.id
      LEFT JOIN utilisateurs u ON d.cree_par = u.id
      ${whereClause}
      ORDER BY d.date_depense DESC, d.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Count
    let countQuery = `SELECT COUNT(*) FROM depenses d ${whereClause}`;
    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].count);

    return {
      data: rows.map(r => ({
        ...r,
        montant: parseFloat(r.montant)
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

export const depenseServiceV2 = new DepenseServiceV2();
