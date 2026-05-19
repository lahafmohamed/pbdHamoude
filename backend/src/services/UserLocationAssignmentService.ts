import pool from '../db/connection';
import { logAudit } from '../middleware/audit';

export interface AssignmentUser {
  id: number;
  username: string;
  nom_complet: string | null;
  role: 'admin' | 'manager' | 'caissier';
  actif: boolean;
  locations: {
    location_id: number;
    est_defaut: boolean;
  }[];
}

export interface AssignmentLocation {
  id: number;
  code: string;
  nom: string;
  est_principal: boolean;
}

class UserLocationAssignmentService {
  async getUsers(): Promise<AssignmentUser[]> {
    const { rows } = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.nom_complet,
         r.nom AS role,
         u.actif,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'location_id', ul.location_id,
               'est_defaut', ul.est_defaut
             )
           ) FILTER (WHERE ul.id IS NOT NULL),
           '[]'::json
         ) AS locations
       FROM utilisateurs u
       LEFT JOIN roles r ON u.role_id = r.id
       LEFT JOIN utilisateur_locations ul ON ul.utilisateur_id = u.id
       GROUP BY u.id, r.nom
       ORDER BY u.actif DESC, r.nom ASC, u.username ASC`
    );

    return rows;
  }

  async getLocations(): Promise<AssignmentLocation[]> {
    const { rows } = await pool.query(
      `SELECT id, code, nom, est_principal
       FROM stock_locations
       WHERE actif = true
       ORDER BY est_principal DESC, nom ASC`
    );

    return rows;
  }

  async getByUserId(userId: number): Promise<AssignmentUser | null> {
    const { rows } = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.nom_complet,
         r.nom AS role,
         u.actif,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'location_id', ul.location_id,
               'est_defaut', ul.est_defaut
             )
           ) FILTER (WHERE ul.id IS NOT NULL),
           '[]'::json
         ) AS locations
       FROM utilisateurs u
       LEFT JOIN roles r ON u.role_id = r.id
       LEFT JOIN utilisateur_locations ul ON ul.utilisateur_id = u.id
       WHERE u.id = $1
       GROUP BY u.id, r.nom`,
      [userId]
    );

    return rows[0] || null;
  }

  async updateAssignments(
    userId: number,
    locationIds: number[],
    defaultLocationId: number | null,
    actorUserId?: number,
    req?: any
  ): Promise<void> {
    const uniqueLocationIds = Array.from(new Set(locationIds));

    if (uniqueLocationIds.length === 0) {
      throw new Error('Au moins une location doit etre affectee');
    }

    if (defaultLocationId && !uniqueLocationIds.includes(defaultLocationId)) {
      throw new Error('La location par defaut doit faire partie des affectations');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userCheck = await client.query('SELECT id FROM utilisateurs WHERE id = $1', [userId]);
      if (userCheck.rowCount === 0) {
        throw new Error('Utilisateur non trouve');
      }

      const locationCheck = await client.query(
        `SELECT id
         FROM stock_locations
         WHERE actif = true
           AND id = ANY($1::int[])`,
        [uniqueLocationIds]
      );

      if ((locationCheck.rowCount || 0) !== uniqueLocationIds.length) {
        throw new Error('Une ou plusieurs locations sont invalides ou inactives');
      }

      await client.query('DELETE FROM utilisateur_locations WHERE utilisateur_id = $1', [userId]);

      for (const locationId of uniqueLocationIds) {
        await client.query(
          `INSERT INTO utilisateur_locations (utilisateur_id, location_id, est_defaut)
           VALUES ($1, $2, $3)`,
          [userId, locationId, defaultLocationId ? locationId === defaultLocationId : false]
        );
      }

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: actorUserId ?? null,
        action: 'update_assignments',
        table_name: 'utilisateur_locations',
        record_id: userId,
        req,
        new_values: {
          location_ids: uniqueLocationIds,
          default_location_id: defaultLocationId,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const userLocationAssignmentService = new UserLocationAssignmentService();
