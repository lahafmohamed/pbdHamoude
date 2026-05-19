import pool from '../db/connection';

export class TaxReportService {
  /**
   * Get TVA collected report for a date range
   */
  async getTVACollected(dateDebut: string, dateFin: string): Promise<any> {
    // TVA collected on sales (invoices)
    const { rows: tvaVendue } = await pool.query(
      `SELECT 
        t.code as taux_code,
        t.taux as taux_pct,
        COUNT(DISTINCT f.id) as nombre_factures,
        COALESCE(SUM(dl.montant_tva), 0) as tva_collectee,
        COALESCE(SUM(dl.total_ligne), 0) as total_ht,
        COALESCE(SUM(dl.total_ligne + dl.montant_tva), 0) as total_ttc
       FROM document_lignes dl
       INNER JOIN factures f ON dl.document_type = 'facture' AND dl.document_id = f.id
       LEFT JOIN taux_tva t ON dl.taux_tva_id = t.id
       WHERE f.date_facture BETWEEN $1 AND $2
         AND f.statut != 'annulee'
         AND f.deleted_at IS NULL
       GROUP BY t.code, t.taux
       ORDER BY t.taux DESC`,
      [dateDebut, dateFin]
    );

    // TVA deductible on purchases (receptions/commands)
    const { rows: tvaAchatee } = await pool.query(
      `SELECT 
        t.code as taux_code,
        t.taux as taux_pct,
        COUNT(DISTINCT c.id) as nombre_commandes,
        COALESCE(SUM(cl.total_ligne * t.taux / 100), 0) as tva deductible,
        COALESCE(SUM(cl.total_ligne), 0) as total_ht,
        COALESCE(SUM(cl.total_ligne * (1 + t.taux / 100)), 0) as total_ttc
       FROM commande_lignes cl
       INNER JOIN commandes_fournisseur c ON cl.commande_id = c.id
       CROSS JOIN taux_tva t
       WHERE c.date_commande BETWEEN $1 AND $2
         AND c.statut != 'annulee'
         AND t.code = 'TVA_19'
       GROUP BY t.code, t.taux
       ORDER BY t.taux DESC`,
      [dateDebut, dateFin]
    );

    // Calculate net TVA payable
    const totalTVACollectee = tvaVendue.reduce((sum, row) => sum + parseFloat(row.tva_collectee), 0);
    const totalTVADeductible = tvaAchatee.reduce((sum, row) => sum + parseFloat(row.tva_deductible || 0), 0);
    const tvaNetAPayer = totalTVACollectee - totalTVADeductible;

    return {
      periode: {
        date_debut: dateDebut,
        date_fin: dateFin,
      },
      tva_collectee: {
        par_taux: tvaVendue.map(row => ({
          taux_code: row.taux_code,
          taux_pct: parseFloat(row.taux_pct),
          nombre_factures: parseInt(row.nombre_factures),
          montant_ht: parseFloat(row.total_ht),
          tva: parseFloat(row.tva_collectee),
          montant_ttc: parseFloat(row.total_ttc),
        })),
        total: totalTVACollectee,
      },
      tva_deductible: {
        par_taux: tvaAchatee.map(row => ({
          taux_code: row.taux_code,
          taux_pct: parseFloat(row.taux_pct),
          nombre_commandes: parseInt(row.nombre_commandes),
          montant_ht: parseFloat(row.total_ht),
          tva: parseFloat(row.tva_deductible || 0),
          montant_ttc: parseFloat(row.total_ttc),
        })),
        total: totalTVADeductible,
      },
      tva_net: {
        montant: tvaNetAPayer,
        message: tvaNetAPayer >= 0 
          ? `TVA à payer: ${tvaNetAPayer.toFixed(2)} XOF`
          : `Crédit de TVA: ${Math.abs(tvaNetAPayer).toFixed(2)} XOF`,
      },
    };
  }

  /**
   * Get monthly TVA summary for the year
   */
  async getMonthlyTVASummary(annee: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT 
        EXTRACT(MONTH FROM f.date_facture) as mois,
        COUNT(DISTINCT f.id) as nombre_factures,
        COALESCE(SUM(dl.montant_tva), 0) as tva_collectee,
        COALESCE(SUM(dl.total_ligne), 0) as total_ht
       FROM document_lignes dl
       INNER JOIN factures f ON dl.document_type = 'facture' AND dl.document_id = f.id
       WHERE EXTRACT(YEAR FROM f.date_facture) = $1
         AND f.statut != 'annulee'
         AND f.deleted_at IS NULL
       GROUP BY EXTRACT(MONTH FROM f.date_facture)
       ORDER BY mois`,
      [annee]
    );

    const monthNames = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];

    return rows.map(row => ({
      mois: parseInt(row.mois),
      mois_nom: monthNames[parseInt(row.mois) - 1],
      nombre_factures: parseInt(row.nombre_factures),
      tva_collectee: parseFloat(row.tva_collectee),
      total_ht: parseFloat(row.total_ht),
    }));
  }
}

export const taxReportService = new TaxReportService();
