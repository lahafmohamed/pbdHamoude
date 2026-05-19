import pool from '../db/connection';
import { caisseMagasinService } from './CaisseMagasinService';

export class POSService {
  private async getPrincipalLocationId(client: any): Promise<number> {
    const { rows } = await client.query(
      'SELECT id FROM stock_locations WHERE est_principal = true AND actif = true LIMIT 1'
    );

    if (rows.length === 0) {
      throw new Error('Aucune location principale active configuree');
    }

    return rows[0].id;
  }

  /**
   * Open a POS session
   */
  async openSession(utilisateurId: number, soldeOuverture: number = 0, locationId?: number): Promise<any> {
    let rows: any[] = [];

    try {
      const result = await pool.query(
        `INSERT INTO pos_sessions (utilisateur_id, solde_ouverture, statut, location_id)
         VALUES ($1, $2, 'ouverte', $3)
         RETURNING *`,
        [utilisateurId, soldeOuverture, locationId || null]
      );
      rows = result.rows;
    } catch (error: any) {
      // Backward compatibility for databases before location_id on pos_sessions.
      if (error?.code !== '42703') {
        throw error;
      }

      const result = await pool.query(
        `INSERT INTO pos_sessions (utilisateur_id, solde_ouverture, statut)
         VALUES ($1, $2, 'ouverte')
         RETURNING *`,
        [utilisateurId, soldeOuverture]
      );
      rows = result.rows;
    }

    return rows[0];
  }

  /**
   * Get current open POS session
   */
  async getCurrentSession(utilisateurId: number): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT * FROM pos_sessions 
       WHERE utilisateur_id = $1 AND statut = 'ouverte'
       ORDER BY date_ouverture DESC
       LIMIT 1`,
      [utilisateurId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Scan barcode and find product
   */
  async scanBarcode(codeBarre: string, utilisateurId?: number): Promise<any> {
    const { rows } = await pool.query(
      `SELECT id, reference, nom, code_barre, prix_vente, stock, categorie
       FROM produits
       WHERE code_barre = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [codeBarre]
    );

    // Log scan
    if (utilisateurId) {
      await pool.query(
        `INSERT INTO barcode_scans (code_barre, produit_id, utilisateur_id, succes)
         VALUES ($1, $2, $3, $4)`,
        [codeBarre, rows.length > 0 ? rows[0].id : null, utilisateurId, rows.length > 0]
      );
    }

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  /**
   * Quick sale - create invoice with stock deduction
   */
  async processQuickSale(
    sessionId: number,
    items: { produit_id: number; quantite: number; prix_unitaire: number }[],
    clientId?: number,
    methodePaiement: string = 'espece',
    creePar?: number
  ): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: sessionRows } = await client.query(
        'SELECT id, statut, location_id FROM pos_sessions WHERE id = $1 FOR UPDATE',
        [sessionId]
      );

      if (sessionRows.length === 0) {
        throw new Error('Session POS introuvable');
      }

      if (sessionRows[0].statut !== 'ouverte') {
        throw new Error('La session POS est fermee');
      }

      const sessionLocationId = sessionRows[0].location_id || await this.getPrincipalLocationId(client);

      // Generate invoice number
      const { rows: seqRows } = await client.query("SELECT nextval('facture_numero_seq') as num");
      const numeroFacture = `POS-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      // Calculate totals (no TVA)
      let sousTotal = 0;
      for (const item of items) {
        sousTotal += item.quantite * item.prix_unitaire;
      }

      const total = sousTotal;

      // Use walk-in client if none specified
      const clientIdFinal = clientId || (await this.getWalkInClientId());

      // Create invoice
      let factureResult: any[] = [];

      try {
        await client.query('SAVEPOINT pos_facture_insert');
        const factureWithLocation = await client.query(
          `INSERT INTO factures (numero_facture, tiers_id, sous_total, tva, total, montant_paye, remaining_due, statut, notes, location_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente', 'Vente POS rapide', $8)
           RETURNING id`,
          [numeroFacture, clientIdFinal, sousTotal, 0, total, total, 0, sessionLocationId]
        );
        factureResult = factureWithLocation.rows;
      } catch (error: any) {
        if (error?.code !== '42703') {
          throw error;
        }

        await client.query('ROLLBACK TO SAVEPOINT pos_facture_insert');
        const factureLegacy = await client.query(
          `INSERT INTO factures (numero_facture, tiers_id, sous_total, tva, total, montant_paye, remaining_due, statut, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente', 'Vente POS rapide')
           RETURNING id`,
          [numeroFacture, clientIdFinal, sousTotal, 0, total, total, 0]
        );
        factureResult = factureLegacy.rows;
      }

      const factureId = factureResult[0].id;

      // Insert lines and update stock
      const produitIds: number[] = [];
      const quantities: number[] = [];
      const prices: number[] = [];
      const totals: number[] = [];

      for (const item of items) {
        produitIds.push(item.produit_id);
        quantities.push(item.quantite);
        prices.push(item.prix_unitaire);
        totals.push(item.quantite * item.prix_unitaire);

        // Check and deduct stock
        const { rows: productRows } = await client.query(
          `SELECT COALESCE(quantite, 0) as quantite
           FROM stock_par_location
           WHERE produit_id = $1 AND location_id = $2
           FOR UPDATE`,
          [item.produit_id, sessionLocationId]
        );

        const currentStock = productRows.length > 0 ? parseInt(productRows[0].quantite, 10) : 0;
        if (currentStock < item.quantite) {
          throw new Error(`Stock insuffisant pour le produit ${item.produit_id}`);
        }

        await client.query(
          `UPDATE stock_par_location
           SET quantite = quantite - $1
           WHERE produit_id = $2 AND location_id = $3`,
          [item.quantite, item.produit_id, sessionLocationId]
        );
      }

      // Batch insert lines without tax
      await client.query(
        `INSERT INTO document_lignes (document_type, document_id, produit_id, quantite, prix_unitaire, total_ligne)
         SELECT 'facture', $1, unnest($2::int[]), unnest($3::int[]), unnest($4::numeric[]), unnest($5::numeric[])`,
        [factureId, produitIds, quantities, prices, totals]
      );

      // Record payment
      const { rows: paiementResult } = await client.query(
        `INSERT INTO paiements (facture_id, montant, methode_paiement, date_paiement, notes)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'Paiement POS rapide')
         RETURNING id`,
        [factureId, total, methodePaiement]
      );

      // If cash payment, inject into caisse
      if (methodePaiement === 'espece') {
        // Find the session active for this location
        const { rows: magRows } = await client.query(
          'SELECT id FROM magasins WHERE location_id = $1 LIMIT 1',
          [sessionLocationId]
        );
        if (magRows.length > 0) {
          const { rows: sessRows } = await client.query(
            'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2 LIMIT 1',
            [magRows[0].id, 'ouverte']
          );
          if (sessRows.length > 0) {
            try {
              await caisseMagasinService.enregistrerMouvement(client, {
                session_caisse_id: sessRows[0].id,
                type: 'encaissement',
                categorie: 'paiement_client',
                montant: total,
                methode_paiement: 'espece',
                reference_type: 'paiement',
                reference_id: paiementResult[0].id,
                libelle: `Vente POS ${numeroFacture}`,
                user_id: creePar || undefined,
              });
            } catch (cashErr: any) {
              // Log but don't fail the sale
              console.warn('⚠️ Could not register POS cash movement:', cashErr.message);
            }
          }
        }
      }

      // Update POS session
      await client.query(
        `UPDATE pos_sessions 
         SET total_ventes = total_ventes + $1, nombre_ventes = nombre_ventes + 1
         WHERE id = $2`,
        [total, sessionId]
      );

      await client.query('COMMIT');

      return {
        facture_id: factureId,
        numero_facture: numeroFacture,
        total: total.toFixed(2),
        methode_paiement: methodePaiement,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get walk-in client ID
   */
  private async getWalkInClientId(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT id FROM tiers WHERE raison_sociale = 'Client Passager' AND est_client = true LIMIT 1`
    );

    if (rows.length === 0) {
      throw new Error('Client passager non trouvé');
    }

    return rows[0].id;
  }

  /**
   * Close POS session
   */
  async closeSession(sessionId: number): Promise<any> {
    const { rows } = await pool.query(
      `UPDATE pos_sessions 
       SET statut = 'fermee', date_fermeture = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    );

    return rows[0];
  }

  /**
   * Get session summary
   */
  async getSessionSummary(sessionId: number): Promise<any> {
    const { rows: sessionRows } = await pool.query(
      'SELECT * FROM pos_sessions WHERE id = $1',
      [sessionId]
    );

    if (sessionRows.length === 0) {
      throw new Error('Session non trouvée');
    }

    const session = sessionRows[0];

    // Get sales by payment method
    const { rows: paymentSummary } = await pool.query(
      `SELECT p.methode_paiement, COUNT(*) as nombre, SUM(p.montant) as total
       FROM paiements p
       INNER JOIN factures f ON p.facture_id = f.id
       WHERE f.notes LIKE '%Vente POS rapide%'
         AND f.date_facture BETWEEN $1 AND COALESCE($2, CURRENT_TIMESTAMP)
       GROUP BY p.methode_paiement`,
      [session.date_ouverture, session.date_fermeture]
    );

    return {
      session,
      resume_paiements: paymentSummary,
    };
  }
}

export const posService = new POSService();
