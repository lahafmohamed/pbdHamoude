import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { UserModel } from '../models/UserModel';
import { generateToken, authenticate, AuthRequest, authorize, revokeSession, revokeAllUserSessions } from '../middleware/auth';
import pool from '../db/connection';
import { logger } from '../utils/logger';

const BCRYPT_ROUNDS = 10;

export class AuthController {
  /**
   * POST /api/auth/login
   * Authenticate user and return JWT token
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username et mot de passe requis',
        });
        return;
      }

      const user = await UserModel.findByUsername(username);

      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Identifiants invalides',
        });
        return;
      }

      if (!user.actif) {
        res.status(403).json({
          success: false,
          error: 'Compte désactivé',
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: 'Identifiants invalides',
        });
        return;
      }

      // Update last login
      await UserModel.updateLastLogin(user.id);

      // Generate token with session tracking
      const token = await generateToken({
        id: user.id,
        username: user.username,
        role: user.role,
        must_change_password: user.must_change_password ?? false,
      }, req);

      // Log audit
      await pool.query(
        `INSERT INTO audit_log (utilisateur_id, action, table_name, record_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, 'login', 'utilisateurs', user.id, req.ip, req.get('user-agent')]
      );

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            nom_complet: user.nom_complet,
            role: user.role,
            must_change_password: user.must_change_password ?? false,
          },
          token,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Login error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * POST /api/auth/logout
   * Logout and revoke session
   */
  static async logout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        await revokeSession(token);
      }

      res.json({
        success: true,
        message: 'Déconnexion réussie',
      });
    } catch (error) {
      logger.error({ err: error }, 'Logout error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * POST /api/auth/revoke-all-sessions (admin only)
   * Revoke all sessions for a user
   */
  static async revokeAllSessions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        res.status(400).json({ error: 'User ID requis' });
        return;
      }

      await revokeAllUserSessions(parseInt(userId));

      res.json({
        success: true,
        message: 'Toutes les sessions ont été révoquées',
      });
    } catch (error) {
      logger.error({ err: error }, 'Revoke all sessions error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * POST /api/auth/register
   * Register a new user (admin only)
   */
  static async register(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { username, email, password, nom_complet, role } = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username et mot de passe requis',
        });
        return;
      }

      // Check if username already exists
      const existingUser = await UserModel.findByUsername(username);
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: 'Username déjà utilisé',
        });
        return;
      }

      // Hash password
      const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Create user
      const user = await UserModel.create({
        username,
        email,
        password_hash,
        nom_complet,
        role_id: 3, // Default caissier
      });

      // Log audit
      await pool.query(
        `INSERT INTO audit_log (utilisateur_id, action, table_name, record_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user!.id, 'create', 'utilisateurs', user.id, req.ip, req.get('user-agent')]
      );

      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          nom_complet: user.nom_complet,
          role: user.role,
          actif: user.actif,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Register error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * GET /api/auth/me
   * Get current user info
   */
  static async me(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Non authentifié',
        });
        return;
      }

      const user = await UserModel.findById(req.user.id);

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Utilisateur non trouvé',
        });
        return;
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      logger.error({ err: error }, 'Me error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * PUT /api/auth/change-password
   * Change current user's password
   */
  static async changePassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: 'Mot de passe actuel et nouveau mot de passe requis',
        });
        return;
      }

      const user = await UserModel.findById(req.user!.id);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Utilisateur non trouvé',
        });
        return;
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        res.status(401).json({
          success: false,
          error: 'Mot de passe actuel incorrect',
        });
        return;
      }

      const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      await pool.query(
        'UPDATE utilisateurs SET password_hash = $1, must_change_password = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, req.user!.id]
      );

      res.json({
        success: true,
        message: 'Mot de passe mis à jour',
      });
    } catch (error) {
      logger.error({ err: error }, 'Change password error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * GET /api/users
   * Get all users (admin only)
   */
  static async getAllUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const { users, total } = await UserModel.findAll(page, limit);

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
      logger.error({ err: error }, 'Get users error');
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }

  /**
   * PUT /api/users/:id
   * Update a user (admin only)
   */
  static async updateUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = parseInt(req.params.id);
      const { email, nom_complet, role_id, actif } = req.body;

      const user = await UserModel.update(userId, {
        email,
        nom_complet,
        role_id,
        actif,
      });

      // Log audit
      await pool.query(
        `INSERT INTO audit_log (utilisateur_id, action, table_name, record_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user!.id, 'update', 'utilisateurs', userId, req.ip, req.get('user-agent')]
      );

      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          nom_complet: user.nom_complet,
          role: user.role,
          actif: user.actif,
        },
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Update user error');
      if (error.message === 'Utilisateur non trouvé') {
        res.status(404).json({
          success: false,
          error: 'Utilisateur non trouvé',
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
      });
    }
  }
}
