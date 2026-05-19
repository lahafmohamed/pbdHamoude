import pool from '../db/connection';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

export class AdminUserService {
  static async getAllUsers(page: number, limit: number) {
    const offset = (page - 1) * limit;

    const [usersResult, countResult] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username, u.email, u.nom_complet, u.actif, u.created_at, u.role_id, r.nom as role,
          (
            SELECT json_agg(json_build_object('id', sl.id, 'nom', sl.nom, 'type', sl.location_type))
            FROM user_location_roles ulr
            JOIN stock_locations sl ON ulr.location_id = sl.id
            WHERE ulr.utilisateur_id = u.id
          ) as locations
         FROM utilisateurs u
         LEFT JOIN roles r ON u.role_id = r.id
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) as total FROM utilisateurs')
    ]);

    return {
      users: usersResult.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

  static async getRoles() {
    const { rows } = await pool.query('SELECT * FROM roles ORDER BY id ASC');
    return rows;
  }

  static async getPermissions() {
    const { rows } = await pool.query('SELECT * FROM permissions ORDER BY module ASC, nom ASC');
    return rows;
  }

  static async createUser(data: any) {
    const { username, email, nom_complet, password, role_id, location_ids } = data;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      
      const userRes = await client.query(
        `INSERT INTO utilisateurs (username, email, nom_complet, password_hash, role_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [username, email, nom_complet, password_hash, role_id]
      );
      
      const newUserId = userRes.rows[0].id;

      if (location_ids && Array.isArray(location_ids) && location_ids.length > 0) {
        for (const locId of location_ids) {
          // Simplistic assignment: map the global role to the location
          // A more complex system could define different roles per location
          await client.query(
            `INSERT INTO user_location_roles (utilisateur_id, location_id, role_at_location, est_defaut)
             VALUES ($1, $2, $3, false)`,
            [newUserId, locId, 'both'] // 'both' or derive from role
          );
        }
        
        // Set first one as default
        await client.query(
          `UPDATE user_location_roles SET est_defaut = true 
           WHERE utilisateur_id = $1 AND location_id = $2`,
          [newUserId, location_ids[0]]
        );
      }

      await client.query('COMMIT');
      return userRes.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async updateUser(id: number, data: any) {
    const { email, nom_complet, role_id, password, actif, location_ids } = data;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const fields: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (email !== undefined) {
        fields.push(`email = $${paramIndex++}`);
        params.push(email);
      }
      if (nom_complet !== undefined) {
        fields.push(`nom_complet = $${paramIndex++}`);
        params.push(nom_complet);
      }
      if (role_id !== undefined) {
        fields.push(`role_id = $${paramIndex++}`);
        params.push(role_id);
      }
      if (actif !== undefined) {
        fields.push(`actif = $${paramIndex++}`);
        params.push(actif);
      }
      if (password) {
        fields.push(`password_hash = $${paramIndex++}`);
        params.push(await bcrypt.hash(password, BCRYPT_ROUNDS));
      }

      if (fields.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE utilisateurs SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
          params
        );
      }

      if (location_ids && Array.isArray(location_ids)) {
        await client.query('DELETE FROM user_location_roles WHERE utilisateur_id = $1', [id]);
        
        if (location_ids.length > 0) {
          for (const locId of location_ids) {
            await client.query(
              `INSERT INTO user_location_roles (utilisateur_id, location_id, role_at_location, est_defaut)
               VALUES ($1, $2, $3, false)`,
              [id, locId, 'both']
            );
          }
          await client.query(
            `UPDATE user_location_roles SET est_defaut = true 
             WHERE utilisateur_id = $1 AND location_id = $2`,
            [id, location_ids[0]]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async getUserPermissions(userId: number) {
    const userRes = await pool.query(
      `SELECT u.id, u.username, u.email, u.nom_complet, u.customiser_permissions, u.role_id, r.nom as role_nom 
       FROM utilisateurs u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new Error('Utilisateur non trouvé');
    }

    const user = userRes.rows[0];

    // Get all permissions
    const permissionsRes = await pool.query(
      'SELECT id, code, nom, description, module FROM permissions ORDER BY module ASC, nom ASC'
    );

    // Get default role permissions
    const rolePermissionsRes = await pool.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = $1',
      [user.role_id]
    );
    const rolePermissionIds = new Set(rolePermissionsRes.rows.map(r => r.permission_id));

    // Get customized permissions
    const userPermissionsRes = await pool.query(
      'SELECT permission_id FROM user_permissions WHERE utilisateur_id = $1',
      [userId]
    );
    const userPermissionIds = new Set(userPermissionsRes.rows.map(r => r.permission_id));

    const permissions = permissionsRes.rows.map(p => {
      const isDefault = rolePermissionIds.has(p.id);
      // If customized, use userPermissionIds. Otherwise, use rolePermissionIds.
      const isEnabled = user.customiser_permissions ? userPermissionIds.has(p.id) : isDefault;

      return {
        ...p,
        is_default: isDefault,
        is_enabled: isEnabled,
      };
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        nom_complet: user.nom_complet,
        role: user.role_nom,
        customiser_permissions: user.customiser_permissions,
      },
      permissions,
    };
  }

  static async updateUserPermissions(userId: number, customiser_permissions: boolean, permissionIds: number[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update customiser_permissions flag
      await client.query(
        'UPDATE utilisateurs SET customiser_permissions = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [customiser_permissions, userId]
      );

      // Clean up previous user custom permissions
      await client.query(
        'DELETE FROM user_permissions WHERE utilisateur_id = $1',
        [userId]
      );

      // If customizer is true and there are custom permissions, insert them
      if (customiser_permissions && Array.isArray(permissionIds) && permissionIds.length > 0) {
        for (const permId of permissionIds) {
          await client.query(
            'INSERT INTO user_permissions (utilisateur_id, permission_id) VALUES ($1, $2)',
            [userId, permId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
