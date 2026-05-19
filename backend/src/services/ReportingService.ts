import pool from '../db/connection';

export class ReportingService {
  /**
   * Profit & Loss summary for a date range
   */
  async getPnL(dateDebut: string, dateFin: string): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        -- Revenue
        COALESCE(SUM(f.total) FILTER (WHERE f.statut != 'annulee'), 0) as chiffre_affaires,
        
        -- Cost of goods sold (based on purchase price * quantity sold)
        COALESCE(SUM(dl.quantite * p.prix_achat) FILTER (WHERE f.statut != 'annulee'), 0) as cout_ventes,
        
        -- Gross margin
        COALESCE(SUM(f.total - (dl.quantite * p.prix_achat)) FILTER (WHERE f.statut != 'annulee'), 0) as marge_brute,
        
        -- Gross margin percentage
        CASE 
          WHEN COALESCE(SUM(f.total) FILTER (WHERE f.statut != 'annulee'), 0) = 0 THEN 0
          ELSE ROUND(
            (COALESCE(SUM(f.total - (dl.quantite * p.prix_achat)) FILTER (WHERE f.statut != 'annulee'), 0) / 
             COALESCE(SUM(f.total) FILTER (WHERE f.statut != 'annulee'), 0)) * 100, 2
          )
        END as marge_pourcentage,
        
        -- Number of invoices
        COUNT(DISTINCT f.id) FILTER (WHERE f.statut != 'annulee') as nombre_factures,
        
        -- Number of products sold
        COALESCE(SUM(dl.quantite) FILTER (WHERE f.statut != 'annulee'), 0) as produits_vendus
       FROM factures f
       LEFT JOIN document_lignes dl ON dl.document_type = 'facture' AND f.id = dl.document_id
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE f.date_facture BETWEEN $1 AND $2`,
      [dateDebut, dateFin]
    );
    return rows[0];
  }

  /**
   * Receivables aging report (who owes what)
   */
  async getReceivablesAging(): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        c.id as client_id,
        c.raison_sociale as nom,
        c.prenom,
        COALESCE(SUM(f.remaining_due) FILTER (WHERE f.statut IN ('en_attente', 'partielle') AND f.deleted_at IS NULL), 0) as total_du,
        COALESCE(SUM(f.remaining_due) FILTER (WHERE f.statut IN ('en_attente', 'partielle') AND f.deleted_at IS NULL AND f.date_facture >= CURRENT_DATE - INTERVAL '30 days'), 0) as moins_30_jours,
        COALESCE(SUM(f.remaining_due) FILTER (WHERE f.statut IN ('en_attente', 'partielle') AND f.deleted_at IS NULL AND f.date_facture BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days'), 0) as entre_30_60_jours,
        COALESCE(SUM(f.remaining_due) FILTER (WHERE f.statut IN ('en_attente', 'partielle') AND f.deleted_at IS NULL AND f.date_facture < CURRENT_DATE - INTERVAL '60 days'), 0) as plus_60_jours
       FROM tiers c
       LEFT JOIN factures f ON c.id = f.tiers_id
       WHERE c.est_client = true AND c.deleted_at IS NULL
       GROUP BY c.id, c.raison_sociale, c.prenom
       HAVING COALESCE(SUM(f.remaining_due) FILTER (WHERE f.statut IN ('en_attente', 'partielle') AND f.deleted_at IS NULL), 0) > 0
       ORDER BY total_du DESC`
    );
    return rows;
  }

  /**
   * Inventory valuation report (FIFO-style weighted average)
   */
  async getInventoryValuation(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as total_produits,
        COALESCE(SUM(stock) FILTER (WHERE deleted_at IS NULL), 0) as total_unites,
        COALESCE(SUM(stock * prix_achat) FILTER (WHERE deleted_at IS NULL), 0) as valeur_achat,
        COALESCE(SUM(stock * prix_vente) FILTER (WHERE deleted_at IS NULL), 0) as valeur_vente,
        COALESCE(SUM(stock * (prix_vente - prix_achat)) FILTER (WHERE deleted_at IS NULL), 0) as marge_potentielle,
        -- Average margin percentage
        CASE 
          WHEN COALESCE(SUM(stock * prix_vente) FILTER (WHERE deleted_at IS NULL), 0) = 0 THEN 0
          ELSE ROUND(
            (COALESCE(SUM(stock * (prix_vente - prix_achat)) FILTER (WHERE deleted_at IS NULL), 0) / 
             COALESCE(SUM(stock * prix_vente) FILTER (WHERE deleted_at IS NULL), 0)) * 100, 2
          )
        END as marge_moyenne_pourcentage
       FROM produits`
    );
    return rows[0];
  }

  /**
   * Inventory turnover rate
   */
  async getInventoryTurnover(days: number = 30): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        COALESCE(SUM(dl.quantite), 0) as unites_vendues,
        COALESCE(AVG(p.stock), 0) as stock_moyen,
        CASE 
          WHEN COALESCE(AVG(p.stock), 0) = 0 THEN 0
          ELSE ROUND(COALESCE(SUM(dl.quantite), 0) / AVG(p.stock), 2)
        END as taux_rotation,
        COUNT(DISTINCT p.id) as produits_actifs
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       LEFT JOIN factures f ON dl.document_type = 'facture' AND dl.document_id = f.id
       WHERE f.date_facture >= CURRENT_DATE - ($1 || ' days')::interval
         AND f.statut != 'annulee'
         AND p.deleted_at IS NULL`,
      [days]
    );
    return rows[0];
  }

  /**
   * Sales by category
   */
  async getSalesByCategory(dateDebut: string, dateFin: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        COALESCE(p.categorie, 'Sans catégorie') as categorie,
        COUNT(DISTINCT f.id) as nombre_factures,
        SUM(dl.quantite) as unites_vendues,
        SUM(f.total) as chiffre_affaires,
        SUM(dl.quantite * p.prix_achat) as cout_ventes,
        SUM(f.total - (dl.quantite * p.prix_achat)) as marge_brute
       FROM factures f
       LEFT JOIN document_lignes dl ON dl.document_type = 'facture' AND f.id = dl.document_id
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE f.date_facture BETWEEN $1 AND $2
         AND f.statut != 'annulee'
       GROUP BY p.categorie
       ORDER BY chiffre_affaires DESC`,
      [dateDebut, dateFin]
    );
    return rows;
  }

  /**
   * Product performance report
   */
  async getProductPerformance(dateDebut: string, dateFin: string, limit: number = 20): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        p.id,
        p.reference,
        p.nom,
        p.categorie,
        p.stock as stock_actuel,
        p.prix_achat,
        p.prix_vente,
        SUM(dl.quantite) as unites_vendues,
        SUM(dl.total_ligne) as chiffre_affaires,
        SUM(dl.quantite * p.prix_achat) as cout_ventes,
        SUM(dl.total_ligne - (dl.quantite * p.prix_achat)) as marge_brute,
        CASE 
          WHEN SUM(dl.total_ligne) = 0 THEN 0
          ELSE ROUND((SUM(dl.total_ligne - (dl.quantite * p.prix_achat)) / SUM(dl.total_ligne)) * 100, 2)
        END as marge_pourcentage
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       LEFT JOIN factures f ON dl.document_type = 'facture' AND dl.document_id = f.id
       WHERE f.date_facture BETWEEN $1 AND $2
         AND f.statut != 'annulee'
         AND p.deleted_at IS NULL
       GROUP BY p.id, p.reference, p.nom, p.categorie, p.stock, p.prix_achat, p.prix_vente
       ORDER BY marge_brute DESC
       LIMIT $3`,
      [dateDebut, dateFin, limit]
    );
    return rows;
  }

  /**
   * Dashboard KPIs
   */
  async getDashboardKPIs(): Promise<any> {
    const [
      revenueResult,
      receivablesResult,
      inventoryResult,
      turnoverResult,
      lowStockResult,
      pendingOrdersResult,
    ] = await Promise.all([
      // Revenue this month
      pool.query(
        `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
         FROM factures
         WHERE statut != 'annulee' AND deleted_at IS NULL
           AND EXTRACT(MONTH FROM date_facture) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(YEAR FROM date_facture) = EXTRACT(YEAR FROM CURRENT_DATE)`
      ),
      // Outstanding receivables
      pool.query(
        `SELECT COALESCE(SUM(remaining_due), 0) as total, COUNT(*) as count
         FROM factures
         WHERE statut IN ('en_attente', 'partielle') AND deleted_at IS NULL`
      ),
      // Inventory value
      pool.query(
        `SELECT COALESCE(SUM(stock * prix_achat), 0) as valeur
         FROM produits
         WHERE deleted_at IS NULL`
      ),
      // Inventory turnover (last 30 days)
      pool.query(
        `SELECT COALESCE(SUM(dl.quantite), 0) / NULLIF(COALESCE(AVG(p.stock), 1), 0) as taux
         FROM document_lignes dl
         LEFT JOIN produits p ON dl.produit_id = p.id
         LEFT JOIN factures f ON dl.document_type = 'facture' AND dl.document_id = f.id
         WHERE f.date_facture >= CURRENT_DATE - INTERVAL '30 days'
           AND f.statut != 'annulee'
           AND p.deleted_at IS NULL`
      ),
      // Low stock alerts
      pool.query(
        `SELECT COUNT(*) as count
         FROM produits
         WHERE stock <= stock_min AND deleted_at IS NULL`
      ),
      // Pending orders
      pool.query(
        `SELECT COUNT(*) as count
         FROM commandes_fournisseur
         WHERE statut IN ('en_attente', 'validee', 'expediee') AND deleted_at IS NULL`
      ),
    ]);

    return {
      revenue_mois: revenueResult.rows[0],
      creances: receivablesResult.rows[0],
      valeur_stock: inventoryResult.rows[0],
      taux_rotation: parseFloat(turnoverResult.rows[0].taux || 0),
      alertes_stock: parseInt(lowStockResult.rows[0].count),
      commandes_en_cours: parseInt(pendingOrdersResult.rows[0].count),
    };
  }
}

export const reportingService = new ReportingService();
