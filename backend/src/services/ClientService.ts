import pool from '../db/connection';
import { BaseService, PaginatedResult, PaginationParams } from './BaseService';

export interface ClientRecord {
  id: number;
  nom: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  nif: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateClientInput {
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  nif?: string;
  cree_par?: number;
}

export interface UpdateClientInput {
  nom?: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  nif?: string;
  modifie_par?: number;
}

export class ClientService extends BaseService<ClientRecord> {
  protected tableName = 'clients';
  protected selectColumns = 'id, nom, prenom, email, telephone, adresse, nif, created_at, updated_at';
  protected defaultSortColumn = 'nom';
  protected allowedSortColumns = ['nom', 'prenom', 'email', 'telephone', 'created_at'];

  /**
   * Get paginated clients with optional search
   */
  async getAll(
    search?: string,
    pagination: PaginationParams = { page: 1, limit: 20, sort: 'nom', order: 'ASC' }
  ): Promise<PaginatedResult<ClientRecord>> {
    let baseWhere = 'WHERE 1=1';
    const params: any[] = [];

    if (search) {
      baseWhere += ' AND (nom ILIKE $' + (params.length + 1) + ' OR prenom ILIKE $' + (params.length + 2) + ' OR email ILIKE $' + (params.length + 3) + ')';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const { dataQuery, countQuery, allParams } = this.buildPaginatedQuery(baseWhere, params, pagination);
    
    return this.executePaginatedQuery(dataQuery, countQuery, allParams, pagination);
  }

  /**
   * Create a new client
   */
  async create(input: CreateClientInput): Promise<ClientRecord> {
    const { rows } = await pool.query(
      `INSERT INTO clients (nom, prenom, email, telephone, adresse, nif, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [input.nom, input.prenom || null, input.email || null, input.telephone || null, input.adresse || null, input.nif || null, input.cree_par || null]
    );
    return rows[0];
  }

  /**
   * Update a client
   */
  async update(id: number, input: UpdateClientInput): Promise<ClientRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.nom !== undefined) { fields.push(`nom = $${paramIndex++}`); params.push(input.nom); }
    if (input.prenom !== undefined) { fields.push(`prenom = $${paramIndex++}`); params.push(input.prenom || null); }
    if (input.email !== undefined) { fields.push(`email = $${paramIndex++}`); params.push(input.email || null); }
    if (input.telephone !== undefined) { fields.push(`telephone = $${paramIndex++}`); params.push(input.telephone || null); }
    if (input.adresse !== undefined) { fields.push(`adresse = $${paramIndex++}`); params.push(input.adresse || null); }
    if (input.nif !== undefined) { fields.push(`nif = $${paramIndex++}`); params.push(input.nif || null); }
    if (input.modifie_par !== undefined) { fields.push(`modifie_par = $${paramIndex++}`); params.push(input.modifie_par); }

    if (fields.length === 0) throw new Error('Aucun champ à mettre à jour');

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE clients SET ${fields.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  /**
   * Get client purchase history
   */
  async getHistorique(clientId: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT f.*, STRING_AGG(p.nom || ' x' || dl.quantite, ', ') as articles
       FROM factures f
       LEFT JOIN document_lignes dl ON dl.document_type = 'facture' AND f.id = dl.document_id
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE f.client_id = $1 AND f.deleted_at IS NULL
       GROUP BY f.id
       ORDER BY f.date_facture DESC`,
      [clientId]
    );
    return rows;
  }
}

export const clientService = new ClientService();
