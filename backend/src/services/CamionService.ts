import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface CreateCamionInput {
  plaque: string;
  marque?: string;
  modele?: string;
  annee?: number;
  capacite_charge_kg?: number;
  chauffeur_id?: number;
  location_id?: number;
  notes?: string;
  cree_par?: number;
  req?: any;
}

export interface CreateRavitaillementInput {
  camion_id: number;
  date_ravitaillement?: string;
  volume_litres: number;
  prix_litre: number;
  kilometrage_depart?: number;
  kilometrage_arrive?: number;
  station_service?: string;
  tiers_id?: number;
  fournisseur_id?: number;
  notes?: string;
  cree_par?: number;
  req?: any;
}

export class CamionService {
  private async generateCamionCode(client: any): Promise<string> {
    const { rows } = await client.query("SELECT nextval('camion_seq') as num");
    return `CAM-${String(rows[0].num).padStart(4, '0')}`;
  }

  private async generateRavitaillementNumero(client: any): Promise<string> {
    const { rows } = await client.query("SELECT nextval('ravitaillement_seq') as num");
    return `RAV-${new Date().getFullYear()}-${String(rows[0].num).padStart(5, '0')}`;
  }

  async getAllCamions(options: { actif?: boolean; page?: number; limit?: number } = {}): Promise<{ data: any[]; total: number }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (options.actif !== undefined) {
      where += ` AND c.actif = $${params.length + 1}`;
      params.push(options.actif);
    }

    const { rows } = await pool.query(
      `SELECT c.*, e.nom as chauffeur_nom, e.prenom as chauffeur_prenom, sl.nom as location_nom
       FROM camions c
       LEFT JOIN employes e ON c.chauffeur_id = e.id
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       ${where}
       ORDER BY c.code ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM camions c ${where}`,
      params
    );

    return { data: rows, total: parseInt(countRows[0].total) };
  }

  async getCamionById(id: number): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT c.*, e.nom as chauffeur_nom, e.prenom as chauffeur_prenom, sl.nom as location_nom
       FROM camions c
       LEFT JOIN employes e ON c.chauffeur_id = e.id
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       WHERE c.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async createCamion(input: CreateCamionInput): Promise<{ id: number; code: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const code = await this.generateCamionCode(client);
      const { plaque, marque, modele, annee, capacite_charge_kg, chauffeur_id, location_id, notes, cree_par, req } = input;

      const { rows } = await client.query(
        `INSERT INTO camions (code, plaque, marque, modele, annee, capacite_charge_kg, chauffeur_id, location_id, notes, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [code, plaque, marque || null, modele || null, annee || null, capacite_charge_kg || null,
         chauffeur_id || null, location_id || null, notes || null, cree_par || null]
      );

      const id = rows[0].id;
      await client.query('COMMIT');

      await logAudit({ utilisateur_id: cree_par || req?.user?.id, action: 'create', table_name: 'camions', record_id: id, req, new_values: { code, plaque } });
      logger.info({ id, code, plaque }, 'Camion created');

      return { id, code };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating camion');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateCamion(id: number, input: Partial<CreateCamionInput>): Promise<boolean> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.plaque !== undefined) { fields.push(`plaque = $${idx++}`); params.push(input.plaque); }
    if (input.marque !== undefined) { fields.push(`marque = $${idx++}`); params.push(input.marque); }
    if (input.modele !== undefined) { fields.push(`modele = $${idx++}`); params.push(input.modele); }
    if (input.annee !== undefined) { fields.push(`annee = $${idx++}`); params.push(input.annee); }
    if (input.capacite_charge_kg !== undefined) { fields.push(`capacite_charge_kg = $${idx++}`); params.push(input.capacite_charge_kg); }
    if (input.chauffeur_id !== undefined) { fields.push(`chauffeur_id = $${idx++}`); params.push(input.chauffeur_id); }
    if (input.location_id !== undefined) { fields.push(`location_id = $${idx++}`); params.push(input.location_id); }
    if (input.notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(input.notes); }

    if (fields.length === 0) return false;

    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE camions SET ${fields.join(', ')} WHERE id = $${idx}`,
      params
    );
    return (rowCount ?? 0) > 0;
  }

  async desactiverCamion(id: number): Promise<boolean> {
    const { rowCount } = await pool.query('UPDATE camions SET actif = false WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async getRavitaillements(camionId?: number, options: { page?: number; limit?: number; date_debut?: string; date_fin?: string } = {}): Promise<{ data: any[]; total: number }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (camionId) {
      where += ` AND r.camion_id = $${params.length + 1}`;
      params.push(camionId);
    }
    if (options.date_debut) {
      where += ` AND r.date_ravitaillement >= $${params.length + 1}`;
      params.push(options.date_debut);
    }
    if (options.date_fin) {
      where += ` AND r.date_ravitaillement <= $${params.length + 1}`;
      params.push(options.date_fin);
    }

    const { rows } = await pool.query(
      `SELECT r.*, c.plaque, c.code as camion_code, t.raison_sociale as fournisseur_nom
       FROM ravitaillements_carburant r
       LEFT JOIN camions c ON r.camion_id = c.id
       LEFT JOIN tiers t ON r.tiers_id = t.id
       ${where}
       ORDER BY r.date_ravitaillement DESC, r.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM ravitaillements_carburant r ${where}`,
      params
    );

    return { data: rows, total: parseInt(countRows[0].total) };
  }

  async createRavitaillement(input: CreateRavitaillementInput): Promise<{ id: number; numero: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const numero = await this.generateRavitaillementNumero(client);
      const { camion_id, volume_litres, prix_litre, kilometrage_depart, kilometrage_arrive,
              station_service, notes, cree_par, req } = input;
      const fournisseur_id = input.tiers_id ?? input.fournisseur_id;
      const date = input.date_ravitaillement || new Date().toISOString().split('T')[0];

      const { rows } = await client.query(
        `INSERT INTO ravitaillements_carburant
           (numero_ravitaillement, camion_id, date_ravitaillement, volume_litres, prix_litre,
            kilometrage_depart, kilometrage_arrive, station_service, tiers_id, notes, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [numero, camion_id, date, volume_litres, prix_litre,
         kilometrage_depart || null, kilometrage_arrive || null,
         station_service || null, fournisseur_id || null, notes || null, cree_par || null]
      );

      const id = rows[0].id;
      await client.query('COMMIT');

      await logAudit({ utilisateur_id: cree_par || req?.user?.id, action: 'create', table_name: 'ravitaillements_carburant', record_id: id, req,
                       new_values: { numero, camion_id, volume_litres, prix_litre } });
      logger.info({ id, numero, camion_id }, 'Ravitaillement created');

      return { id, numero };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating ravitaillement');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStats(camionId?: number): Promise<any> {
    const where = camionId ? 'WHERE r.camion_id = $1' : '';
    const params = camionId ? [camionId] : [];

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) as total_ravitaillements,
         COALESCE(SUM(r.volume_litres), 0) as total_litres,
         COALESCE(SUM(r.cout_total), 0) as cout_total,
         COALESCE(AVG(r.prix_litre), 0) as prix_moyen_litre,
         COALESCE(SUM(r.distance_km), 0) as total_km,
         CASE WHEN COALESCE(SUM(r.volume_litres), 0) > 0
              THEN ROUND(COALESCE(SUM(r.distance_km), 0)::NUMERIC / SUM(r.volume_litres) * 100, 2)
              ELSE 0 END as km_par_100l
       FROM ravitaillements_carburant r
       ${where}`,
      params
    );

    return rows[0];
  }
}

export const camionService = new CamionService();
