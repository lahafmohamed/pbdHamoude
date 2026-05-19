import pool from '../db/connection';
import { BaseService } from './BaseService';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface TransferLigneInput {
  produit_id: number;
  quantite_demandee: number;
}

export interface CreateTransferInput {
  location_source_id: number;
  location_destination_id: number;
  lignes: TransferLigneInput[];
  notes?: string;
  cree_par?: number;
  req?: any;
}

export interface TransferRecord {
  id: number;
  numero_transfer: string;
  location_source_id: number;
  location_destination_id: number;
  date_transfer: string;
  statut: string;
  notes: string | null;
  cree_par: number | null;
  created_at: string;
}

export class StockTransferService extends BaseService<TransferRecord> {
  protected tableName = 'stock_transfers';
  protected selectColumns = 'st.id, st.numero_transfer, st.location_source_id, st.location_destination_id, st.date_transfer, st.statut, st.notes, st.cree_par, st.created_at, ls.nom as source_nom, ld.nom as destination_nom';
  protected defaultSortColumn = 'created_at';
  protected allowedSortColumns = ['created_at', 'date_transfer', 'statut'];

  /**
   * Get all transfers with pagination
   */
  async getAll(options?: { search?: string; statut?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ${this.selectColumns}
      FROM stock_transfers st
      LEFT JOIN stock_locations ls ON st.location_source_id = ls.id
      LEFT JOIN stock_locations ld ON st.location_destination_id = ld.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.statut) {
      query += ` AND st.statut = $${params.length + 1}`;
      params.push(options.statut);
    }

    query += ' ORDER BY st.created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM stock_transfers st WHERE 1=1`;
    const countParams: any[] = [];
    if (options?.statut) {
      countQuery += ` AND st.statut = $${countParams.length + 1}`;
      countParams.push(options.statut);
    }
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].total);

    return { data: rows, total };
  }

  /**
   * Get transfer with line items
   */
  async getById(id: number): Promise<any | null> {
    const { rows: transferRows } = await pool.query(
      `SELECT ${this.selectColumns}
       FROM stock_transfers st
       LEFT JOIN stock_locations ls ON st.location_source_id = ls.id
       LEFT JOIN stock_locations ld ON st.location_destination_id = ld.id
       WHERE st.id = $1`,
      [id]
    );

    if (transferRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT stl.*, p.nom as produit_nom, p.reference
       FROM stock_transfer_lignes stl
       LEFT JOIN produits p ON stl.produit_id = p.id
       WHERE stl.transfer_id = $1`,
      [id]
    );

    return {
      ...transferRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Create transfer
   */
  async create(input: CreateTransferInput): Promise<{ id: number; numero_transfer: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { location_source_id, location_destination_id, lignes, notes, cree_par, req } = input;

      if (location_source_id === location_destination_id) {
        throw new Error('Les locations source et destination doivent être différentes');
      }

      if (!lignes || lignes.length === 0) {
        throw new Error('Le transfer doit contenir au moins un produit');
      }

      // Generate transfer number
      const { rows: seqRows } = await client.query("SELECT nextval('transfer_numero_seq') as num");
      const numeroTransfer = `TRF-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      // Insert transfer
      const { rows: transferResult } = await client.query(
        'INSERT INTO stock_transfers (numero_transfer, location_source_id, location_destination_id, notes, cree_par) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [numeroTransfer, location_source_id, location_destination_id, notes || null, cree_par || null]
      );

      const transferId = transferResult[0].id;

      // Insert line items
      for (const ligne of lignes) {
        // Check source stock availability
        const { rows: stockRows } = await client.query(
          'SELECT quantite FROM stock_par_location WHERE produit_id = $1 AND location_id = $2',
          [ligne.produit_id, location_source_id]
        );

        const availableStock = stockRows.length > 0 ? parseInt(stockRows[0].quantite) : 0;

        if (ligne.quantite_demandee > availableStock) {
          await client.query('ROLLBACK');
          throw new Error(`Stock insuffisant pour le produit ${ligne.produit_id}: disponible ${availableStock}, demandé ${ligne.quantite_demandee}`);
        }

        await client.query(
          'INSERT INTO stock_transfer_lignes (transfer_id, produit_id, quantite_demandee) VALUES ($1, $2, $3)',
          [transferId, ligne.produit_id, ligne.quantite_demandee]
        );
      }

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: cree_par || (req?.user?.id),
        action: 'create',
        table_name: 'stock_transfers',
        record_id: transferId,
        req,
        new_values: { numero_transfer: numeroTransfer, location_source_id, location_destination_id },
      });

      logger.info({ transferId, numeroTransfer }, 'Stock transfer created');

      return { id: transferId, numero_transfer: numeroTransfer };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating stock transfer');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete transfer (move stock)
   */
  async complete(transferId: number, userId?: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get transfer details
      const { rows: transferRows } = await client.query(
        'SELECT * FROM stock_transfers WHERE id = $1 AND statut = $2',
        [transferId, 'en_preparation']
      );

      if (transferRows.length === 0) {
        throw new Error('Transfer not found or not in "en_preparation" status');
      }

      const transfer = transferRows[0];

      // Get line items
      const { rows: lignesRows } = await client.query(
        'SELECT * FROM stock_transfer_lignes WHERE transfer_id = $1',
        [transferId]
      );

      // Update stock: decrease from source, increase at destination
      for (const ligne of lignesRows) {
        // Capture stock before for movement records
        const { rows: srcBefore } = await client.query(
          `SELECT COALESCE(quantite, 0) as quantite FROM stock_par_location
           WHERE produit_id = $1 AND location_id = $2`,
          [ligne.produit_id, transfer.location_source_id]
        );
        const srcAvant = srcBefore.length > 0 ? parseInt(srcBefore[0].quantite) : 0;

        const { rows: dstBefore } = await client.query(
          `SELECT COALESCE(quantite, 0) as quantite FROM stock_par_location
           WHERE produit_id = $1 AND location_id = $2`,
          [ligne.produit_id, transfer.location_destination_id]
        );
        const dstAvant = dstBefore.length > 0 ? parseInt(dstBefore[0].quantite) : 0;

        // Decrease source
        await client.query(
          'UPDATE stock_par_location SET quantite = quantite - $1 WHERE produit_id = $2 AND location_id = $3',
          [ligne.quantite_demandee, ligne.produit_id, transfer.location_source_id]
        );

        // Increase destination (or insert if doesn't exist)
        await client.query(
          `INSERT INTO stock_par_location (produit_id, location_id, quantite)
           VALUES ($1, $2, $3)
           ON CONFLICT (produit_id, location_id)
           DO UPDATE SET quantite = stock_par_location.quantite + $3`,
          [ligne.produit_id, transfer.location_destination_id, ligne.quantite_demandee]
        );

        // Stock movement records (one out, one in)
        const ref = `Transfert TRF-${transferId}`;
        await client.query(
          `INSERT INTO mouvements_stock
             (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, location_id)
           VALUES ($1, 'transfert', $2, $3, $4, $5, $6, $7)`,
          [ligne.produit_id, -ligne.quantite_demandee, srcAvant, srcAvant - ligne.quantite_demandee, ref, ref, transfer.location_source_id]
        );
        await client.query(
          `INSERT INTO mouvements_stock
             (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, location_id)
           VALUES ($1, 'transfert', $2, $3, $4, $5, $6, $7)`,
          [ligne.produit_id, ligne.quantite_demandee, dstAvant, dstAvant + ligne.quantite_demandee, ref, ref, transfer.location_destination_id]
        );

        // Update transferred quantity
        await client.query(
          'UPDATE stock_transfer_lignes SET quantite_transferee = $1 WHERE id = $2',
          [ligne.quantite_demandee, ligne.id]
        );
      }

      // Update transfer status
      await client.query(
        'UPDATE stock_transfers SET statut = $1 WHERE id = $2',
        ['livre', transferId]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: userId,
        action: 'complete',
        table_name: 'stock_transfers',
        record_id: transferId,
        req,
      });

      logger.info({ transferId }, 'Stock transfer completed');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error completing stock transfer');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const stockTransferService = new StockTransferService();
