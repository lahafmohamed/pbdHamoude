import pool from '../db/connection';
import { BaseService } from './BaseService';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { checkPeriodIsOpen } from './PeriodService';

export interface FactureFournisseurLigneInput {
  produit_id?: number;
  description?: string;
  quantite: number;
  prix_unitaire: number;
  tva_taux?: number;
}

export interface CreateFactureFournisseurInput {
  tiers_id: number;
  fournisseur_id?: number;
  reception_id?: number;
  numero_facture_fournisseur: string;
  date_facture: string;
  date_echeance?: string;
  condition_paiement?: string;
  lignes: FactureFournisseurLigneInput[];
  notes?: string;
  cree_par?: number;
  req?: any;
}

export interface FactureFournisseurRecord {
  id: number;
  tiers_id: number;
  commande_id: number | null;
  reception_id: number | null;
  numero_facture_fournisseur: string;
  numero_facture_interne: string;
  date_facture: string;
  date_echeance: string | null;
  sous_total: number;
  tva: number;
  total: number;
  montant_paye: number;
  reste_due: number;
  statut: string;
  condition_paiement: string | null;
  notes: string | null;
  cree_par: number | null;
  created_at: string;
}

export class FactureFournisseurService extends BaseService<FactureFournisseurRecord> {
  protected tableName = 'factures_fournisseur';
  protected selectColumns = 'ff.id, ff.tiers_id, ff.commande_id, ff.reception_id, ff.numero_facture_fournisseur, ff.numero_facture_interne, ff.date_facture, ff.date_echeance, ff.sous_total, ff.tva, ff.total, ff.montant_paye, ff.reste_due, ff.statut, ff.condition_paiement, ff.notes, ff.cree_par, ff.created_at, t.raison_sociale as fournisseur_nom';
  protected defaultSortColumn = 'created_at';
  protected allowedSortColumns = ['created_at', 'date_facture', 'date_echeance', 'total', 'statut'];

  /**
   * Get all supplier invoices with pagination
   */
  async getAll(options?: { search?: string; statut?: string; tiers_id?: number; fournisseur_id?: number; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ${this.selectColumns}
      FROM factures_fournisseur ff
      LEFT JOIN tiers t ON ff.tiers_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];

    const filterTiersId = options?.tiers_id ?? options?.fournisseur_id;
    if (filterTiersId) { query += ` AND ff.tiers_id = $${params.length + 1}`; params.push(filterTiersId); }

    if (options?.statut) {
      query += ` AND ff.statut = $${params.length + 1}`;
      params.push(options.statut);
    }

    if (options?.search) {
      query += ` AND (ff.numero_facture_fournisseur ILIKE $${params.length + 1} OR ff.numero_facture_interne ILIKE $${params.length + 2} OR t.raison_sociale ILIKE $${params.length + 3})`;
      params.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
    }

    query += ' ORDER BY ff.date_facture DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM factures_fournisseur ff LEFT JOIN tiers t ON ff.tiers_id = t.id WHERE 1=1`;
    const countParams: any[] = [];
    if (filterTiersId) { countQuery += ` AND ff.tiers_id = $${countParams.length + 1}`; countParams.push(filterTiersId); }
    if (options?.statut) {
      countQuery += ` AND ff.statut = $${countParams.length + 1}`;
      countParams.push(options.statut);
    }
    if (options?.search) {
      countQuery += ` AND (ff.numero_facture_fournisseur ILIKE $${countParams.length + 1} OR ff.numero_facture_interne ILIKE $${countParams.length + 2} OR t.raison_sociale ILIKE $${countParams.length + 3})`;
      countParams.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
    }
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].total);

    return { data: rows, total };
  }

  /**
   * Get supplier invoice with line items
   */
  async getById(id: number): Promise<any | null> {
    const { rows: invoiceRows } = await pool.query(
      `SELECT ${this.selectColumns}, r.numero_reception
       FROM factures_fournisseur ff
       LEFT JOIN tiers t ON ff.tiers_id = t.id
       LEFT JOIN receptions r ON ff.reception_id = r.id
       WHERE ff.id = $1`,
      [id]
    );

    if (invoiceRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT ffl.*, p.nom as produit_nom, p.reference as produit_reference
       FROM facture_fournisseur_lignes ffl
       LEFT JOIN produits p ON ffl.produit_id = p.id
       WHERE ffl.facture_id = $1`,
      [id]
    );

    return {
      ...invoiceRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Create supplier invoice
   */
  async create(input: CreateFactureFournisseurInput): Promise<{ id: number; numero_facture_interne: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await checkPeriodIsOpen(new Date(), client);

      const tiers_id_fourn = input.tiers_id ?? input.fournisseur_id!;
      const { reception_id, numero_facture_fournisseur, date_facture, date_echeance, condition_paiement, lignes, notes, cree_par, req } = input;

      if (!lignes || lignes.length === 0) {
        throw new Error('La facture doit contenir au moins une ligne');
      }

      // Generate internal invoice number
      const { rows: seqRows } = await client.query("SELECT nextval('facture_fournisseur_numero_seq') as num");
      const numeroFactureInterne = `FF-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      // Calculate totals
      let sousTotal = 0;

      for (const ligne of lignes) {
        const totalLigne = ligne.quantite * ligne.prix_unitaire;
        sousTotal += totalLigne;
      }

      const total = sousTotal;

      // Insert invoice
      const { rows: invoiceResult } = await client.query(
        `INSERT INTO factures_fournisseur
         (tiers_id, reception_id, numero_facture_fournisseur, numero_facture_interne, date_facture, date_echeance, condition_paiement, sous_total, tva, total, notes, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11)
         RETURNING id`,
        [tiers_id_fourn, reception_id || null, numero_facture_fournisseur, numeroFactureInterne, date_facture, date_echeance || null, condition_paiement || null, sousTotal, total, notes || null, cree_par || null]
      );

      const invoiceId = invoiceResult[0].id;

      // Insert line items
      for (const ligne of lignes) {
        const totalLigne = ligne.quantite * ligne.prix_unitaire;

        await client.query(
          `INSERT INTO facture_fournisseur_lignes
           (facture_id, produit_id, description, quantite, prix_unitaire, total_ligne)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invoiceId, ligne.produit_id || null, ligne.description || null, ligne.quantite, ligne.prix_unitaire, totalLigne]
        );
      }

      // Supplier ledger: credit entry (new invoice increases AP liability)
      await client.query(
        `INSERT INTO compte_fournisseur_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'facture', $2, $3, 0, $4, $5, $6)`,
        [tiers_id_fourn, invoiceId, numeroFactureInterne, total, notes || null, cree_par || null]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: cree_par || (req?.user?.id),
        action: 'create',
        table_name: 'factures_fournisseur',
        record_id: invoiceId,
        req,
        new_values: { numero_facture_interne: numeroFactureInterne, tiers_id: tiers_id_fourn, total },
      });

      logger.info({ invoiceId, numeroFactureInterne, tiers_id: tiers_id_fourn }, 'Supplier invoice created');

      return { id: invoiceId, numero_facture_interne: numeroFactureInterne };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating supplier invoice');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record payment for supplier invoice
   */
  async recordPayment(factureId: number, montant: number, methodePaiement: string, reference?: string, effectuePar?: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get invoice total
      const { rows: invoiceRows } = await client.query(
        'SELECT total, montant_paye FROM factures_fournisseur WHERE id = $1',
        [factureId]
      );

      if (invoiceRows.length === 0) {
        throw new Error('Facture non trouvée');
      }

      const invoice = invoiceRows[0];
      const remainingDue = invoice.total - invoice.montant_paye;

      if (montant > remainingDue) {
        throw new Error(`Le montant du paiement (${montant}) dépasse le reste dû (${remainingDue})`);
      }

      // Get fournisseur_id for ledger entry
      const { rows: ffRows } = await client.query(
        'SELECT tiers_id, numero_facture_interne FROM factures_fournisseur WHERE id = $1',
        [factureId]
      );
      const { tiers_id: ff_tiers_id, numero_facture_interne } = ffRows[0];

      // Insert payment
      const { rows: paiementResult } = await client.query(
        `INSERT INTO paiements_fournisseur (facture_id, montant, methode_paiement, reference, effectue_par)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [factureId, montant, methodePaiement, reference || null, effectuePar || null]
      );

      // Supplier ledger: debit entry (payment reduces AP liability)
      await client.query(
        `INSERT INTO compte_fournisseur_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'paiement', $2, $3, $4, 0, $5, $6)`,
        [ff_tiers_id, paiementResult[0].id, `PAI-FF-${paiementResult[0].id}`, montant, null, effectuePar || null]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: effectuePar || (req?.user?.id),
        action: 'create',
        table_name: 'paiements_fournisseur',
        record_id: factureId,
        req,
        new_values: { montant, methode_paiement: methodePaiement },
      });

      logger.info({ factureId, montant }, 'Supplier payment recorded');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error recording supplier payment');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get payable invoices (due or overdue)
   */
  async getPayableInvoices(): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT ff.*, f.nom as fournisseur_nom,
              ff.total - ff.montant_paye as reste_du,
              CASE 
                WHEN ff.date_echeance < CURRENT_DATE THEN 'en_retard'
                WHEN ff.date_echeance <= CURRENT_DATE + INTERVAL '7 days' THEN 'bientot_echu'
                ELSE 'a_echeance'
              END as statut_echeance
       FROM factures_fournisseur ff
       LEFT JOIN tiers t ON ff.tiers_id = t.id
       WHERE ff.statut NOT IN ('payee', 'annulee')
         AND (ff.total - ff.montant_paye) > 0
       ORDER BY ff.date_echeance ASC`
    );
    return rows;
  }

  /**
   * Get supplier invoice statistics
   */
  async getStats(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) as total_factures,
        COALESCE(SUM(total), 0) as valeur_totale,
        COALESCE(SUM(total - montant_paye), 0) as reste_du_total,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as factures_en_attente,
        COUNT(CASE WHEN statut = 'payee' THEN 1 END) as factures_payees
       FROM factures_fournisseur`
    );
    return rows[0];
  }
}

export const factureFournisseurService = new FactureFournisseurService();
