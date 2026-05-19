import pool from '../db/connection';

export class CashVarianceService {
  /**
   * Get daily cash variance report
   * Compares expected cash vs actual cash counted
   */
  async getDailyVariance(date: string): Promise<any> {
    // Get all cash register sessions for the day
    const { rows: sessions } = await pool.query(
      `SELECT 
        sc.*,
        u.username as utilisateur_nom
       FROM sessions_caisse sc
       LEFT JOIN utilisateurs u ON sc.utilisateur_id = u.id
       WHERE DATE(sc.date_ouverture) = $1
       ORDER BY sc.date_ouverture ASC`,
      [date]
    );

    // Calculate total expected cash from all sales
    const { rows: salesData } = await pool.query(
      `SELECT 
        COALESCE(SUM(p.montant), 0) as total_cash_ventes,
        COUNT(DISTINCT p.facture_id) as nombre_ventes
       FROM paiements p
       INNER JOIN factures f ON p.facture_id = f.id
       WHERE DATE(f.date_facture) = $1
         AND p.methode_paiement = 'espece'`,
      [date]
    );

    // Get other cash movements
    const { rows: otherMovements } = await pool.query(
      `SELECT 
        mc.type_mouvement,
        COUNT(*) as nombre,
        COALESCE(SUM(mc.montant), 0) as total
       FROM mouvements_caisse mc
       INNER JOIN sessions_caisse sc ON mc.session_id = sc.id
       WHERE DATE(sc.date_ouverture) = $1
       GROUP BY mc.type_mouvement`,
      [date]
    );

    // Get payment breakdown
    const { rows: paymentBreakdown } = await pool.query(
      `SELECT 
        p.methode_paiement,
        COUNT(*) as nombre,
        COALESCE(SUM(p.montant), 0) as total
       FROM paiements p
       INNER JOIN factures f ON p.facture_id = f.id
       WHERE DATE(f.date_facture) = $1
       GROUP BY p.methode_paiement
       ORDER BY total DESC`,
      [date]
    );

    // Calculate totals
    const totalCashVentes = parseFloat(salesData[0].total_cash_ventes);
    const nombreVentes = parseInt(salesData[0].nombre_ventes);

    let totalOuverture = 0;
    let totalFermeture = 0;
    let totalTheorique = 0;
    let totalEcart = 0;

    sessions.forEach(session => {
      totalOuverture += parseFloat(session.solde_ouverture);
      if (session.solde_fermeture) {
        totalFermeture += parseFloat(session.solde_fermeture);
      }
      if (session.solde_theorique) {
        totalTheorique += parseFloat(session.solde_theorique);
      }
      if (session.ecart) {
        totalEcart += parseFloat(session.ecart);
      }
    });

    return {
      date: date,
      resume: {
        total_cash_ventes: totalCashVentes,
        nombre_ventes: nombreVentes,
        total_ouverture: totalOuverture,
        total_fermeture: totalFermeture,
        total_theorique: totalTheorique,
        total_ecart: totalEcart,
        pourcentage_variance: totalTheorique > 0 ? ((totalEcart / totalTheorique) * 100).toFixed(2) : '0.00',
      },
      sessions: sessions.map(s => ({
        id: s.id,
        utilisateur: s.utilisateur_nom,
        ouverture: parseFloat(s.solde_ouverture),
        fermeture: s.solde_fermeture ? parseFloat(s.solde_fermeture) : null,
        theorique: s.solde_theorique ? parseFloat(s.solde_theorique) : null,
        ecart: s.ecart ? parseFloat(s.ecart) : null,
        date_ouverture: s.date_ouverture,
        date_fermeture: s.date_fermeture,
      })),
      par_methode_paiement: paymentBreakdown,
      autres_mouvements: otherMovements,
    };
  }

  /**
   * Get cash variance for a date range
   */
  async getVarianceRange(dateDebut: string, dateFin: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT 
        DATE(sc.date_ouverture) as date,
        COUNT(DISTINCT sc.id) as nombre_sessions,
        COALESCE(SUM(sc.solde_ouverture), 0) as total_ouverture,
        COALESCE(SUM(sc.solde_fermeture), 0) as total_fermeture,
        COALESCE(SUM(sc.solde_theorique), 0) as total_theorique,
        COALESCE(SUM(sc.ecart), 0) as total_ecart
       FROM sessions_caisse sc
       WHERE DATE(sc.date_ouverture) BETWEEN $1 AND $2
         AND sc.statut = 'fermee'
       GROUP BY DATE(sc.date_ouverture)
       ORDER BY date DESC`,
      [dateDebut, dateFin]
    );

    return rows.map(row => ({
      date: row.date,
      nombre_sessions: parseInt(row.nombre_sessions),
      total_ouverture: parseFloat(row.total_ouverture),
      total_fermeture: parseFloat(row.total_fermeture),
      total_theorique: parseFloat(row.total_theorique),
      total_ecart: parseFloat(row.total_ecart),
    }));
  }

  /**
   * Get user cash performance
   */
  async getUserPerformance(utilisateurId: number, dateDebut: string, dateFin: string): Promise<any> {
    const { rows: sessions } = await pool.query(
      `SELECT 
        sc.*,
        u.username
       FROM sessions_caisse sc
       LEFT JOIN utilisateurs u ON sc.utilisateur_id = u.id
       WHERE sc.utilisateur_id = $1
         AND DATE(sc.date_ouverture) BETWEEN $2 AND $3
         AND sc.statut = 'fermee'
       ORDER BY sc.date_ouverture DESC`,
      [utilisateurId, dateDebut, dateFin]
    );

    let totalEcart = 0;
    let nombreSessions = sessions.length;
    let nombreEcartsPositifs = 0;
    let nombreEcartsNegatifs = 0;

    sessions.forEach(session => {
      const ecart = parseFloat(session.ecart || 0);
      totalEcart += ecart;
      if (ecart > 0) nombreEcartsPositifs++;
      if (ecart < 0) nombreEcartsNegatifs++;
    });

    return {
      utilisateur_id: utilisateurId,
      username: sessions.length > 0 ? sessions[0].username : null,
      periode: {
        date_debut: dateDebut,
        date_fin: dateFin,
      },
      nombre_sessions: nombreSessions,
      ecart_moyen: nombreSessions > 0 ? (totalEcart / nombreSessions).toFixed(2) : '0.00',
      ecart_total: totalEcart.toFixed(2),
      ecarts_positifs: nombreEcartsPositifs,
      ecarts_negatifs: nombreEcartsNegatifs,
      taux_conformite: nombreSessions > 0 ? (((nombreSessions - nombreEcartsNegatifs) / nombreSessions) * 100).toFixed(2) : '100.00',
    };
  }
}

export const cashVarianceService = new CashVarianceService();
