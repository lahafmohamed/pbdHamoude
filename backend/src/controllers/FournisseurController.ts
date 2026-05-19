import { Request, Response } from 'express';
import pool from '../db/connection';

export class FournisseurController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, page = '1', limit = '20', sort = 'nom', order = 'asc' } = req.query;
      
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      const offset = (pageNum - 1) * limitNum;
      
      let query = 'SELECT id, nom, contact, telephone, email, adresse, delai_livraison, notes, created_at FROM fournisseurs WHERE 1=1';
      const params: any[] = [];

      if (search) {
        query += ' AND (nom ILIKE $1 OR contact ILIKE $2 OR email ILIKE $3)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      // Whitelist sort columns
      const allowedSort = ['nom', 'created_at'];
      const sortColumn = allowedSort.includes(sort as string) ? sort : 'nom';
      const orderDirection = order === 'desc' ? 'DESC' : 'ASC';
      
      query += ` ORDER BY ${sortColumn} ${orderDirection}`;
      query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limitNum, offset);

      const { rows } = await pool.query(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) as total FROM fournisseurs WHERE 1=1';
      const countParams: any[] = [];
      if (search) {
        countQuery += ' AND (nom ILIKE $1 OR contact ILIKE $2 OR email ILIKE $3)';
        countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const { rows: countRows } = await pool.query(countQuery, countParams);
      const total = parseInt(countRows[0].total);

      res.json({
        data: rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      });
    } catch (error) {
      console.error('Erreur GET /api/fournisseurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { rows } = await pool.query('SELECT * FROM fournisseurs WHERE id = $1', [id]);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Fournisseur non trouvé' });
        return;
      }

      res.json(rows[0]);
    } catch (error) {
      console.error('Erreur GET /api/fournisseurs/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    try {
      const { nom, contact, telephone, email, adresse, delai_livraison, notes } = req.body;

      const { rows } = await pool.query(
        'INSERT INTO fournisseurs (nom, contact, telephone, email, adresse, delai_livraison, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [nom, contact || null, telephone || null, email || null, adresse || null, delai_livraison || 7, notes || null]
      );

      res.status(201).json({ id: rows[0].id, message: 'Fournisseur créé' });
    } catch (error) {
      console.error('Erreur POST /api/fournisseurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { nom, contact, telephone, email, adresse, delai_livraison, notes } = req.body;

      const { rowCount } = await pool.query(
        'UPDATE fournisseurs SET nom=$1, contact=$2, telephone=$3, email=$4, adresse=$5, delai_livraison=$6, notes=$7 WHERE id=$8',
        [nom, contact || null, telephone || null, email || null, adresse || null, delai_livraison || 7, notes || null, id]
      );

      if (rowCount === 0) {
        res.status(404).json({ error: 'Fournisseur non trouvé' });
        return;
      }

      res.json({ message: 'Fournisseur modifié' });
    } catch (error) {
      console.error('Erreur PUT /api/fournisseurs/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { rowCount } = await pool.query('DELETE FROM fournisseurs WHERE id = $1', [id]);

      if (rowCount === 0) {
        res.status(404).json({ error: 'Fournisseur non trouvé' });
        return;
      }

      res.json({ message: 'Fournisseur supprimé' });
    } catch (error: any) {
      if (error.code === '23503') {
        res.status(400).json({ error: 'Ce fournisseur est lié à des commandes' });
        return;
      }
      console.error('Erreur DELETE /api/fournisseurs/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}
