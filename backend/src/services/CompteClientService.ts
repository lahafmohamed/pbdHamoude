import pool from '../db/connection';

export class CompteClientService {
  private getEffectiveRemainingDueExpr(alias: string): string {
    return `CASE
      WHEN COALESCE(${alias}.remaining_due, 0) > 0 THEN COALESCE(${alias}.remaining_due, 0)
      ELSE GREATEST(COALESCE(${alias}.total, 0) - COALESCE(${alias}.montant_paye, 0), 0)
    END`;
  }

  /**
   * Record advance payment from customer
   */
  async recordAdvance(
    clientId: number,
    montant: number,
    methodePaiement: string,
    notes?: string,
    creePar?: number
  ): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current balance
      const { rows: balanceRows } = await client.query(
        'SELECT solde_client_actuel FROM tiers WHERE id = $1',
        [clientId]
      );
      const soldeAvant = parseFloat(balanceRows[0].solde_client_actuel || 0);
      const soldeApres = soldeAvant - montant; // Advance decreases balance

      // Insert advance
      const { rows: acompteRows } = await client.query(
        `INSERT INTO acomptes_clients (tiers_id, montant, methode_paiement, notes, cree_par)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, date_acompte`,
        [clientId, montant, methodePaiement, notes || null, creePar || null]
      );

      // Insert ledger line
      await client.query(
        `INSERT INTO compte_client_lignes
         (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, solde_avant, solde_apres, notes)
         VALUES ($1, 'acompte', $2, $3, 0, $4, $5, $6, $7)`,
        [clientId, acompteRows[0].id, `ACO-${acompteRows[0].id}`, montant, soldeAvant, soldeApres, notes || null]
      );

      // Update tiers balance
      await client.query(
        'UPDATE tiers SET solde_client_actuel = $2 WHERE id = $1',
        [clientId, soldeApres]
      );

      await client.query('COMMIT');

      return {
        id: acompteRows[0].id,
        date_acompte: acompteRows[0].date_acompte,
        montant: montant,
        nouveau_solde: soldeApres,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get customer current balance
   */
  async getBalance(clientId: number): Promise<any> {
    const effectiveDueExpr = this.getEffectiveRemainingDueExpr('f');

    const { rows } = await pool.query(
      `SELECT 
        c.id,
        c.nom,
        c.prenom,
        c.credit_max,
        COALESCE(c.acompte_disponible, 0) as acompte_disponible,
        COALESCE((
          SELECT SUM(${effectiveDueExpr})
          FROM factures f
          WHERE f.tiers_id = c.id
            AND f.deleted_at IS NULL
            AND f.statut != 'annulee'
        ), 0) as total_factures_du
       FROM tiers c
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [clientId]
    );

    if (rows.length === 0) {
      throw new Error('Client non trouvé');
    }

    const client = rows[0];
    const totalFacturesDu = parseFloat(client.total_factures_du || 0);
    const acompteDisponible = parseFloat(client.acompte_disponible || 0);
    const soldeActuel = totalFacturesDu - acompteDisponible;
    const creditMax = parseFloat(client.credit_max || 0);
    const creditDisponible = creditMax - soldeActuel;
    const statutSolde = soldeActuel > 0 ? 'debiteur' : soldeActuel < 0 ? 'crediteur' : 'solde_nul';

    return {
      client_id: client.id,
      client_nom: `${client.raison_sociale || client.nom || ''} ${client.prenom || ''}`.trim(),
      solde_actuel: soldeActuel,
      acompte_disponible: acompteDisponible,
      total_factures_du: totalFacturesDu,
      credit_max: creditMax,
      credit_disponible: creditDisponible,
      statut: statutSolde,
      message: this.getBalanceMessage({
        solde_actuel: soldeActuel,
        acompte_disponible: acompteDisponible,
      }),
    };
  }

  /**
   * Get account statement (relevé de compte)
   */
  async getAccountStatement(clientId: number, dateDebut?: string, dateFin?: string): Promise<any> {
    // Client info
    const { rows: clientRows } = await pool.query(
      'SELECT raison_sociale, prenom, solde_client_actuel as solde_actuel, acompte_disponible FROM tiers WHERE id = $1',
      [clientId]
    );

    if (clientRows.length === 0) {
      throw new Error('Client non trouvé');
    }

    // Transaction lines
    let query = `
      SELECT 
        ccl.id,
        ccl.date_operation,
        ccl.type_operation,
        ccl.document_numero,
        ccl.montant_debit,
        ccl.montant_credit,
        ccl.solde_avant,
        ccl.solde_apres,
        ccl.notes
      FROM compte_client_lignes ccl
      WHERE ccl.tiers_id = $1
    `;
    const params: any[] = [clientId];

    if (dateDebut) {
      params.push(dateDebut);
      query += ` AND ccl.date_operation >= $${params.length}`;
    }

    if (dateFin) {
      params.push(dateFin);
      query += ` AND ccl.date_operation <= $${params.length}`;
    }

    query += ' ORDER BY ccl.date_operation ASC, ccl.id ASC';

    const { rows: lignes } = await pool.query(query, params);

    // Calculate totals
    const totalDebit = lignes.reduce((sum, l) => sum + parseFloat(l.montant_debit), 0);
    const totalCredit = lignes.reduce((sum, l) => sum + parseFloat(l.montant_credit), 0);

    return {
      client: {
        id: clientId,
        nom: `${clientRows[0].raison_sociale || clientRows[0].nom || ''} ${clientRows[0].prenom || ''}`.trim(),
        solde_actuel: parseFloat(clientRows[0].solde_actuel),
        acompte_disponible: parseFloat(clientRows[0].acompte_disponible),
      },
      periode: {
        date_debut: dateDebut || 'Début',
        date_fin: dateFin || 'Maintenant',
      },
      lignes: lignes.map(l => ({
        ...l,
        montant_debit: parseFloat(l.montant_debit),
        montant_credit: parseFloat(l.montant_credit),
        solde_avant: parseFloat(l.solde_avant),
        solde_apres: parseFloat(l.solde_apres),
      })),
      resume: {
        total_debit: totalDebit,
        total_credit: totalCredit,
        solde_final: totalDebit - totalCredit,
      },
    };
  }

  /**
   * Get customer aging report
   */
  async getAging(clientId: number): Promise<any> {
    const effectiveDueExpr = this.getEffectiveRemainingDueExpr('f');

    const { rows } = await pool.query(
      `SELECT 
        f.id as facture_id,
        f.numero_facture,
        f.date_facture,
        f.total,
        f.montant_paye,
        ${effectiveDueExpr} as remaining_due,
        f.statut,
        CURRENT_DATE - DATE(f.date_facture) as jours_retard
       FROM factures f
       WHERE f.tiers_id = $1
         AND f.statut != 'annulee'
         AND f.deleted_at IS NULL
         AND ${effectiveDueExpr} > 0
       ORDER BY f.date_facture ASC`,
      [clientId]
    );

    // Group by age brackets
    let courant = 0;
    let jours_1_30 = 0;
    let jours_31_60 = 0;
    let jours_61_90 = 0;
    let plus_90 = 0;

    rows.forEach((row: any) => {
      const montant = parseFloat(row.remaining_due);
      const retard = parseInt(row.jours_retard);

      if (retard <= 0) courant += montant;
      else if (retard <= 30) jours_1_30 += montant;
      else if (retard <= 60) jours_31_60 += montant;
      else if (retard <= 90) jours_61_90 += montant;
      else plus_90 += montant;
    });

    return {
      client_id: clientId,
      factures_impayees: rows.map((r: any) => ({
        facture_id: r.facture_id,
        numero_facture: r.numero_facture,
        date_facture: r.date_facture,
        total: parseFloat(r.total),
        reste_du: parseFloat(r.remaining_due),
        jours_retard: parseInt(r.jours_retard),
      })),
      resume: {
        courant: courant,
        jours_1_30: jours_1_30,
        jours_31_60: jours_31_60,
        jours_61_90: jours_61_90,
        plus_90_jours: plus_90,
        total_du: courant + jours_1_30 + jours_31_60 + jours_61_90 + plus_90,
      },
    };
  }

  /**
   * Apply advance payment to invoice
   */
  async applyAdvanceToInvoice(clientId: number, factureId: number, acompteId: number): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get advance
      const { rows: acompteRows } = await client.query(
        'SELECT * FROM acomptes_clients WHERE id = $1 AND tiers_id = $2 AND statut = $3',
        [acompteId, clientId, 'disponible']
      );

      if (acompteRows.length === 0) {
        throw new Error('Acompte non disponible');
      }

      const acompte = acompteRows[0];
      const montantAcompte = parseFloat(acompte.montant);

      // Get invoice
      const { rows: factureRows } = await client.query(
        `SELECT *, ${this.getEffectiveRemainingDueExpr('factures')} as remaining_due_effective
         FROM factures
         WHERE id = $1 AND tiers_id = $2 AND ${this.getEffectiveRemainingDueExpr('factures')} > 0`,
        [factureId, clientId]
      );

      if (factureRows.length === 0) {
        throw new Error('Facture non trouvée ou déjà payée');
      }

      const facture = factureRows[0];
      const remainingDue = parseFloat(facture.remaining_due_effective);

      // Calculate amount to apply
      const montantApplique = Math.min(montantAcompte, remainingDue);

      // Record payment
      await client.query(
        `INSERT INTO paiements (facture_id, montant, methode_paiement, date_paiement, notes)
         VALUES ($1, $2, 'acompte', CURRENT_TIMESTAMP, 'Acompte #${acompteId}')`,
        [factureId, montantApplique]
      );

      // Update advance status
      if (montantApplique >= montantAcompte) {
        await client.query(
          `UPDATE acomptes_clients 
           SET statut = 'utilise', facture_id_applique = $1, date_utilisation = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [factureId, acompteId]
        );
      }

      // Insert ledger line
      const { rows: balanceRows } = await client.query(
        'SELECT solde_client_actuel FROM tiers WHERE id = $1',
        [clientId]
      );
      const soldeAvant = parseFloat(balanceRows[0].solde_client_actuel);
      const soldeApres = soldeAvant - montantApplique;

      await client.query(
        `INSERT INTO compte_client_lignes
         (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, solde_avant, solde_apres)
         VALUES ($1, 'paiement', $2, $3, 0, $4, $5, $6)`,
        [clientId, factureId, facture.numero_facture, montantApplique, soldeAvant, soldeApres]
      );

      await client.query('COMMIT');

      return {
        acompte_id: acompteId,
        facture_id: factureId,
        montant_applique: montantApplique,
        reste_acompte: montantAcompte - montantApplique,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record ledger line manually (for adjustments)
   */
  async recordLedgerLine(
    clientId: number,
    typeOperation: string,
    montantDebit: number,
    montantCredit: number,
    documentNumero?: string,
    notes?: string,
    creePar?: number
  ): Promise<any> {
    const { rows: balanceRows } = await pool.query(
      'SELECT solde_client_actuel FROM tiers WHERE id = $1',
      [clientId]
    );
    const soldeAvant = parseFloat(balanceRows[0].solde_client_actuel || 0);
    const soldeApres = soldeAvant + montantDebit - montantCredit;

    const { rows } = await pool.query(
      `INSERT INTO compte_client_lignes
       (tiers_id, type_operation, document_numero, montant_debit, montant_credit, solde_avant, solde_apres, notes, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, date_operation`,
      [clientId, typeOperation, documentNumero || null, montantDebit, montantCredit, soldeAvant, soldeApres, notes || null, creePar || null]
    );

    return rows[0];
  }

  /**
   * Get balance message
   */
  private getBalanceMessage(client: any): string {
    const solde = parseFloat(client.solde_actuel);
    const acompte = parseFloat(client.acompte_disponible);

    if (solde > 0) {
      return `Le client doit ${solde.toFixed(2)} XOF`;
    } else if (solde < 0) {
      return `Vous devez ${Math.abs(solde).toFixed(2)} XOF au client`;
    } else if (acompte > 0) {
      return `Client a un acompte de ${acompte.toFixed(2)} XOF disponible`;
    } else {
      return 'Compte soldé';
    }
  }
}

export const compteClientService = new CompteClientService();
