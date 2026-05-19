import { Request, Response } from 'express';
import pool from '../db/connection';
import { AuthRequest } from '../middleware/auth';

export class CommandeController {

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { statut, search } = req.query;
      let query = `
        SELECT c.*, t.raison_sociale as fournisseur_nom
        FROM commandes_fournisseur c
        LEFT JOIN tiers t ON c.tiers_id = t.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (statut) {
        query += ' AND c.statut = $' + (params.length + 1);
        params.push(statut);
      }

      if (search) {
        query += ' AND (c.numero_commande ILIKE $' + (params.length + 1) + ' OR t.raison_sociale ILIKE $' + (params.length + 2) + ')';
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ' ORDER BY c.date_commande DESC';

      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (error) {
      console.error('Erreur GET /api/commandes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const { rows: commandeRows } = await pool.query(
        `SELECT c.*, t.raison_sociale as fournisseur_nom, t.telephone as fournisseur_telephone, t.email as fournisseur_email
         FROM commandes_fournisseur c
         LEFT JOIN tiers t ON c.tiers_id = t.id
         WHERE c.id = $1`,
        [id]
      );

      if (commandeRows.length === 0) {
        res.status(404).json({ error: 'Commande non trouvée' });
        return;
      }

      const { rows: lignesRows } = await pool.query(
        `SELECT cl.*, p.nom as produit_nom, p.reference as produit_reference
         FROM commande_lignes cl
         LEFT JOIN produits p ON cl.produit_id = p.id
         WHERE cl.commande_id = $1`,
        [id]
      );

      res.json({
        ...commandeRows[0],
        lignes: lignesRows
      });
    } catch (error) {
      console.error('Erreur GET /api/commandes/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async create(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const authReq = req as AuthRequest;
      const { tiers_id, fournisseur_id, lignes, notes, date_livraison_prevue }: {
        tiers_id?: number;
        fournisseur_id?: number;
        lignes: { produit_id: number; quantite: number; prix_unitaire: number }[];
        notes?: string;
        date_livraison_prevue?: string;
      } = req.body;
      const resolvedTiersId = tiers_id ?? fournisseur_id;

      if (!lignes || lignes.length === 0) {
        res.status(400).json({ error: 'La commande doit contenir au moins un produit' });
        return;
      }

      // Generate order number via PostgreSQL sequence
      const { rows: seqRows } = await client.query("SELECT nextval('commande_numero_seq') as num");
      const numeroCommande = `CMD-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      // Calculate totals
      let sousTotal = 0;
      for (const ligne of lignes) {
        sousTotal += ligne.quantite * ligne.prix_unitaire;
      }

      // Insert order
      const { rows: commandeResult } = await client.query(
        'INSERT INTO commandes_fournisseur (numero_commande, tiers_id, sous_total, notes, date_livraison_prevue) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [numeroCommande, resolvedTiersId, sousTotal, notes || null, date_livraison_prevue || null]
      );

      const commandeId = commandeResult[0].id;

      // Insert line items
      for (const ligne of lignes) {
        const totalLigne = ligne.quantite * ligne.prix_unitaire;

        await client.query(
          'INSERT INTO commande_lignes (commande_id, produit_id, quantite, prix_unitaire, total_ligne) VALUES ($1, $2, $3, $4, $5)',
          [commandeId, ligne.produit_id, ligne.quantite, ligne.prix_unitaire, totalLigne]
        );
      }

      // Auto-create a facture_fournisseur (brouillon) linked to this commande
      const { rows: ffSeqRows } = await client.query("SELECT nextval('facture_fournisseur_numero_seq') as num");
      const numeroFactureInterne = `FF-${new Date().getFullYear()}-${String(ffSeqRows[0].num).padStart(5, '0')}`;
      const today = new Date().toISOString().split('T')[0];
      const cree_par = authReq.user?.id || null;

      const { rows: ffResult } = await client.query(
        `INSERT INTO factures_fournisseur
         (tiers_id, commande_id, numero_facture_fournisseur, numero_facture_interne, date_facture, sous_total, tva, total, statut, notes, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 'en_attente', $8, $9)
         RETURNING id`,
        [resolvedTiersId, commandeId, numeroCommande, numeroFactureInterne, today, sousTotal, sousTotal, notes || null, cree_par]
      );

      const factureId = ffResult[0].id;

      for (const ligne of lignes) {
        const totalLigne = ligne.quantite * ligne.prix_unitaire;
        await client.query(
          `INSERT INTO facture_fournisseur_lignes
           (facture_id, produit_id, quantite, prix_unitaire, total_ligne)
           VALUES ($1, $2, $3, $4, $5)`,
          [factureId, ligne.produit_id, ligne.quantite, ligne.prix_unitaire, totalLigne]
        );
      }

      await client.query('COMMIT');

      res.status(201).json({
        id: commandeId,
        numero_commande: numeroCommande,
        facture_fournisseur_id: factureId,
        numero_facture_interne: numeroFactureInterne,
        message: 'Commande et facture fournisseur créées'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur POST /api/commandes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  static async updateStatut(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { statut }: { statut: string } = req.body;

      const { rows: commandeRows } = await client.query(
        'SELECT statut FROM commandes_fournisseur WHERE id = $1',
        [id]
      );

      if (commandeRows.length === 0) {
        res.status(404).json({ error: 'Commande non trouvée' });
        return;
      }

      // Transitioning to 'livree' directly is blocked — stock must be updated via ReceptionController
      if (statut === 'livree') {
        await client.query('ROLLBACK');
        res.status(400).json({
          error: 'Impossible de marquer une commande comme livrée directement. Utilisez la réception de marchandises pour enregistrer les produits reçus et mettre à jour le stock.'
        });
        return;
      } else {
        await client.query(
          'UPDATE commandes_fournisseur SET statut = $1 WHERE id = $2',
          [statut, id]
        );
      }

      await client.query('COMMIT');
      res.json({ message: 'Statut mis à jour' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur PUT /api/commandes/:id/statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { rowCount } = await pool.query('DELETE FROM commandes_fournisseur WHERE id = $1', [id]);

      if (rowCount === 0) {
        res.status(404).json({ error: 'Commande non trouvée' });
        return;
      }

      res.json({ message: 'Commande supprimée' });
    } catch (error) {
      console.error('Erreur DELETE /api/commandes/:id:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE statut = 'en_attente') as en_attente,
          COUNT(*) FILTER (WHERE statut = 'validee') as validee,
          COUNT(*) FILTER (WHERE statut = 'expediee') as expediee,
          COUNT(*) FILTER (WHERE statut = 'livree') as livree,
          COUNT(*) FILTER (WHERE statut = 'annulee') as annulee
         FROM commandes_fournisseur`
      );
      res.json(rows[0]);
    } catch (error) {
      console.error('Erreur GET /api/commandes/stats:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}
