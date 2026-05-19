import { Request, Response } from 'express';
import { AdminUserService } from '../services/AdminUserService';
import { logger } from '../utils/logger';

export class AdminUserController {
  static async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const { users, total } = await AdminUserService.getAllUsers(page, limit);

      res.json({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching users');
      res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
    }
  }

  static async getRoles(req: Request, res: Response): Promise<void> {
    try {
      const roles = await AdminUserService.getRoles();
      res.json({ success: true, data: roles });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching roles');
      res.status(500).json({ success: false, error: 'Erreur interne' });
    }
  }

  static async getPermissions(req: Request, res: Response): Promise<void> {
    try {
      const permissions = await AdminUserService.getPermissions();
      res.json({ success: true, data: permissions });
    } catch (error) {
      logger.error({ err: error }, 'Error fetching permissions');
      res.status(500).json({ success: false, error: 'Erreur interne' });
    }
  }

  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, role_id } = req.body;
      if (!username || !password || !role_id) {
        res.status(400).json({ success: false, error: 'Username, password et role sont requis' });
        return;
      }

      const user = await AdminUserService.createUser(req.body);
      res.status(201).json({ success: true, data: user, message: 'Utilisateur créé avec succès' });
    } catch (error: any) {
      logger.error({ err: error }, 'Error creating user');
      if (error.code === '23505') { // unique violation
        res.status(409).json({ success: false, error: "Ce nom d'utilisateur existe déjà" });
        return;
      }
      res.status(500).json({ success: false, error: "Erreur lors de la création de l'utilisateur" });
    }
  }

  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      await AdminUserService.updateUser(id, req.body);
      res.json({ success: true, message: 'Utilisateur mis à jour avec succès' });
    } catch (error) {
      logger.error({ err: error }, 'Error updating user');
      res.status(500).json({ success: false, error: "Erreur lors de la mise à jour de l'utilisateur" });
    }
  }

  static async getUserPermissions(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const data = await AdminUserService.getUserPermissions(id);
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error({ err: error }, 'Error fetching user permissions');
      res.status(500).json({ success: false, error: error.message || 'Erreur interne' });
    }
  }

  static async updateUserPermissions(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { customiser_permissions, permission_ids } = req.body;
      await AdminUserService.updateUserPermissions(id, customiser_permissions, permission_ids);
      res.json({ success: true, message: 'Permissions de l\'utilisateur mises à jour avec succès' });
    } catch (error: any) {
      logger.error({ err: error }, 'Error updating user permissions');
      res.status(500).json({ success: false, error: error.message || 'Erreur interne' });
    }
  }
}
