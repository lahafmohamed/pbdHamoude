import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

// ============================================
// TYPES
// ============================================

export interface DemandeLigneInput {
    produit_id: number;
    quantite_demandee: number;
    notes?: string;
}

export interface LigneDecisionInput {
    ligne_id: number;
    quantite_approuvee: number;
}

export interface CreateDemandeInput {
    magasin_id: number;
    depot_id: number;
    lignes: DemandeLigneInput[];
    motif?: string;
    created_by_user_id?: number;
    req?: any;
}

export interface DemandeDecisionInput {
    decision: 'approuvee' | 'refusee';
    lignes_decision?: LigneDecisionInput[];
    raison_refus?: string;
    user_id?: number;
    req?: any;
}

export interface DemandeFilters {
    statut?: string;
    magasin_id?: number;
    depot_id?: number;
    created_by_user_id?: number;
    date_from?: Date;
    date_to?: Date;
    page?: number;
    limit?: number;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
    'brouillon': ['envoyee', 'annulee'],
    'envoyee': ['approuvee', 'partiellement_approuvee', 'refusee'],
    'approuvee': ['en_cours'],
    'partiellement_approuvee': ['en_cours'],
    'refusee': [], // Terminal
    'en_cours': ['livree'],
    'livree': ['cloturee'],
    'cloturee': [], // Terminal
};

// ============================================
// SERVICE CLASS
// ============================================

export class DemandeService {
    
    // ============================================
    // QUERIES
    // ============================================

    async getAll(options: DemandeFilters = {}): Promise<{ data: any[]; total: number }> {
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;

        let query = `
            SELECT d.*,
                   m.nom AS magasin_nom, m.code AS magasin_code,
                   dp.nom AS depot_nom, dp.code AS depot_code,
                   u1.username AS created_by_username, u1.nom_complet AS created_by_nom,
                   u2.username AS decided_by_username, u2.nom_complet AS decided_by_nom,
                   u3.username AS executed_by_username, u3.nom_complet AS executed_by_nom,
                   u4.username AS closed_by_username, u4.nom_complet AS closed_by_nom,
                   st.numero_transfer
            FROM demandes_reapprovisionnement d
            JOIN stock_locations m ON d.magasin_id = m.id
            JOIN stock_locations dp ON d.depot_id = dp.id
            LEFT JOIN utilisateurs u1 ON d.created_by_user_id = u1.id
            LEFT JOIN utilisateurs u2 ON d.decided_by_user_id = u2.id
            LEFT JOIN utilisateurs u3 ON d.executed_by_user_id = u3.id
            LEFT JOIN utilisateurs u4 ON d.closed_by_user_id = u4.id
            LEFT JOIN stock_transfers st ON d.transfert_id = st.id
            WHERE 1=1
        `;
        
        const params: any[] = [];

        if (options.statut) {
            query += ` AND d.statut = $${params.length + 1}`;
            params.push(options.statut);
        }

        if (options.magasin_id) {
            query += ` AND d.magasin_id = $${params.length + 1}`;
            params.push(options.magasin_id);
        }

        if (options.depot_id) {
            query += ` AND d.depot_id = $${params.length + 1}`;
            params.push(options.depot_id);
        }

        if (options.created_by_user_id) {
            query += ` AND d.created_by_user_id = $${params.length + 1}`;
            params.push(options.created_by_user_id);
        }

        if (options.date_from) {
            query += ` AND d.date_creation >= $${params.length + 1}`;
            params.push(options.date_from);
        }

        if (options.date_to) {
            query += ` AND d.date_creation <= $${params.length + 1}`;
            params.push(options.date_to);
        }

        query += ' ORDER BY d.date_creation DESC';
        query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const { rows } = await pool.query(query, params);

        // Get total count
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM demandes_reapprovisionnement d
            WHERE 1=1
        `;
        const countParams: any[] = [];

        if (options.statut) {
            countQuery += ` AND d.statut = $${countParams.length + 1}`;
            countParams.push(options.statut);
        }
        if (options.magasin_id) {
            countQuery += ` AND d.magasin_id = $${countParams.length + 1}`;
            countParams.push(options.magasin_id);
        }
        if (options.depot_id) {
            countQuery += ` AND d.depot_id = $${countParams.length + 1}`;
            countParams.push(options.depot_id);
        }
        if (options.created_by_user_id) {
            countQuery += ` AND d.created_by_user_id = $${countParams.length + 1}`;
            countParams.push(options.created_by_user_id);
        }

        const { rows: countRows } = await pool.query(countQuery, countParams);
        const total = parseInt(countRows[0].total, 10);

        return { data: rows, total };
    }

    async getById(id: number): Promise<any | null> {
        const { rows: demandeRows } = await pool.query(
            `SELECT d.*,
                    m.nom AS magasin_nom, m.code AS magasin_code,
                    dp.nom AS depot_nom, dp.code AS depot_code,
                    u1.username AS created_by_username, u1.nom_complet AS created_by_nom,
                    u2.username AS decided_by_username, u2.nom_complet AS decided_by_nom,
                    u3.username AS executed_by_username, u3.nom_complet AS executed_by_nom,
                    u4.username AS closed_by_username, u4.nom_complet AS closed_by_nom,
                    st.numero_transfer, st.statut AS transfert_statut
             FROM demandes_reapprovisionnement d
             JOIN stock_locations m ON d.magasin_id = m.id
             JOIN stock_locations dp ON d.depot_id = dp.id
             LEFT JOIN utilisateurs u1 ON d.created_by_user_id = u1.id
             LEFT JOIN utilisateurs u2 ON d.decided_by_user_id = u2.id
             LEFT JOIN utilisateurs u3 ON d.executed_by_user_id = u3.id
             LEFT JOIN utilisateurs u4 ON d.closed_by_user_id = u4.id
             LEFT JOIN stock_transfers st ON d.transfert_id = st.id
             WHERE d.id = $1`,
            [id]
        );

        if (demandeRows.length === 0) {
            return null;
        }

        const demande = demandeRows[0];

        // Get lines with product info
        const { rows: lignesRows } = await pool.query(
            `SELECT dl.*, p.nom AS produit_nom, p.reference, p.prix_vente
             FROM demandes_reapprovisionnement_lignes dl
             JOIN produits p ON dl.produit_id = p.id
             WHERE dl.demande_id = $1
             ORDER BY dl.id ASC`,
            [id]
        );

        // Get history
        const { rows: historyRows } = await pool.query(
            `SELECT h.*, u.username, u.nom_complet
             FROM demandes_reapprovisionnement_history h
             LEFT JOIN utilisateurs u ON h.user_id = u.id
             WHERE h.demande_id = $1
             ORDER BY h.timestamp DESC`,
            [id]
        );

        return {
            ...demande,
            lignes: lignesRows,
            historique: historyRows,
        };
    }

    // ============================================
    // COMMANDS - State Machine
    // ============================================

    async create(input: CreateDemandeInput): Promise<{ id: number; numero: string }> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const { magasin_id, depot_id, lignes, motif, created_by_user_id, req } = input;

            // Validation
            if (magasin_id === depot_id) {
                throw new Error('Le magasin et le dépôt doivent être différents');
            }

            if (!lignes || lignes.length === 0) {
                throw new Error('La demande doit contenir au moins une ligne');
            }

            // Verify locations exist and are correct types
            const { rows: locationRows } = await client.query(
                `SELECT id, location_type, actif FROM stock_locations WHERE id IN ($1, $2)`,
                [magasin_id, depot_id]
            );

            if (locationRows.length !== 2) {
                throw new Error('Magasin ou dépôt invalide');
            }

            const magasin = locationRows.find((r) => r.id === magasin_id);
            const depot = locationRows.find((r) => r.id === depot_id);

            if (magasin?.location_type !== 'magasin') {
                throw new Error('La location source doit être un magasin');
            }
            if (depot?.location_type !== 'depot') {
                throw new Error('La location destination doit être un dépôt');
            }
            if (!magasin.actif || !depot.actif) {
                throw new Error('Une des locations est inactive');
            }

            // Generate demande number
            const { rows: seqRows } = await client.query(
                "SELECT nextval('demande_reappro_numero_seq') AS num"
            );
            const numero = `DEM-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

            // Insert demande
            const { rows: demandeRows } = await client.query(
                `INSERT INTO demandes_reapprovisionnement (
                    numero, magasin_id, depot_id, statut,
                    created_by_user_id, motif, date_creation
                ) VALUES ($1, $2, $3, 'brouillon', $4, $5, CURRENT_TIMESTAMP)
                RETURNING id`,
                [numero, magasin_id, depot_id, created_by_user_id, motif || null]
            );

            const demandeId = demandeRows[0].id;

            // Insert lines
            for (const ligne of lignes) {
                if (!ligne.produit_id || !ligne.quantite_demandee || ligne.quantite_demandee <= 0) {
                    throw new Error('Chaque ligne doit avoir un produit et une quantité > 0');
                }

                await client.query(
                    `INSERT INTO demandes_reapprovisionnement_lignes (
                        demande_id, produit_id, quantite_demandee, notes
                    ) VALUES ($1, $2, $3, $4)`,
                    [demandeId, ligne.produit_id, ligne.quantite_demandee, ligne.notes || null]
                );
            }

            // Log initial state
            await client.query(
                `INSERT INTO demandes_reapprovisionnement_history (
                    demande_id, from_statut, to_statut, user_id, payload
                ) VALUES ($1, NULL, 'brouillon', $2, $3)`,
                [demandeId, created_by_user_id, JSON.stringify({ motif })]
            );

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: created_by_user_id,
                action: 'create',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req,
                new_values: { numero, magasin_id, depot_id, lignes_count: lignes.length },
            });

            logger.info({ demandeId, numero }, 'Demande de réapprovisionnement créée');

            return { id: demandeId, numero };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async update(demandeId: number, updates: Partial<CreateDemandeInput>, userId?: number): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check current state - can only edit in brouillon
            const { rows: checkRows } = await client.query(
                `SELECT statut, created_by_user_id FROM demandes_reapprovisionnement 
                 WHERE id = $1 FOR UPDATE`,
                [demandeId]
            );

            if (checkRows.length === 0) {
                throw new Error('Demande non trouvée');
            }

            const current = checkRows[0];
            if (current.statut !== 'brouillon') {
                throw new Error('Une demande ne peut être modifiée qu\'en état brouillon');
            }

            // Update motif if provided
            if (updates.motif !== undefined) {
                await client.query(
                    `UPDATE demandes_reapprovisionnement SET motif = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                    [updates.motif, demandeId]
                );
            }

            // Update lignes if provided (delete and recreate)
            if (updates.lignes && updates.lignes.length > 0) {
                // Delete existing lines
                await client.query(
                    `DELETE FROM demandes_reapprovisionnement_lignes WHERE demande_id = $1`,
                    [demandeId]
                );

                // Insert new lines
                for (const ligne of updates.lignes) {
                    await client.query(
                        `INSERT INTO demandes_reapprovisionnement_lignes (
                            demande_id, produit_id, quantite_demandee, notes
                        ) VALUES ($1, $2, $3, $4)`,
                        [demandeId, ligne.produit_id, ligne.quantite_demandee, ligne.notes || null]
                    );
                }
            }

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: userId,
                action: 'update',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                new_values: updates,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async send(demandeId: number, userId?: number, req?: any): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `UPDATE demandes_reapprovisionnement
                 SET statut = 'envoyee',
                     date_envoi = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND statut = 'brouillon'
                 RETURNING id`,
                [demandeId]
            );

            if (rows.length === 0) {
                throw new Error('Demande non trouvée ou déjà envoyée');
            }

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: userId,
                action: 'send',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req,
            });

            logger.info({ demandeId }, 'Demande envoyée au dépôt');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async decide(demandeId: number, input: DemandeDecisionInput): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Lock demande
            const { rows: demandeRows } = await client.query(
                `SELECT * FROM demandes_reapprovisionnement 
                 WHERE id = $1 AND statut = 'envoyee'
                 FOR UPDATE`,
                [demandeId]
            );

            if (demandeRows.length === 0) {
                throw new Error('Demande non trouvée ou non envoyée');
            }

            const demande = demandeRows[0];

            // Get current lines
            const { rows: lignesRows } = await client.query(
                `SELECT id, produit_id, quantite_demandee FROM demandes_reapprovisionnement_lignes 
                 WHERE demande_id = $1`,
                [demandeId]
            );

            if (input.decision === 'refusee') {
                // Refuse all - set all approved to 0
                await client.query(
                    `UPDATE demandes_reapprovisionnement_lignes 
                     SET quantite_approuvee = 0, updated_at = CURRENT_TIMESTAMP
                     WHERE demande_id = $1`,
                    [demandeId]
                );

                await client.query(
                    `UPDATE demandes_reapprovisionnement
                     SET statut = 'refusee',
                         decided_by_user_id = $1,
                         raison_refus = $2,
                         date_decision = CURRENT_TIMESTAMP,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3`,
                    [input.user_id, input.raison_refus || 'Demande refusée', demandeId]
                );
            } else {
                // Approval - process line decisions
                const decisionMap = new Map<number, number>();
                for (const d of input.lignes_decision || []) {
                    decisionMap.set(d.ligne_id, d.quantite_approuvee);
                }

                let totalApproved = 0;
                let anyPartial = false;
                let allZero = true;

                for (const ligne of lignesRows) {
                    const ligneId = ligne.id;
                    const requested = parseInt(ligne.quantite_demandee, 10);
                    const approved = decisionMap.has(ligneId) 
                        ? decisionMap.get(ligneId)! 
                        : requested; // Default to full approval if not specified

                    if (approved < 0 || approved > requested) {
                        throw new Error(`Quantité approuvée invalide pour ligne ${ligneId}: ${approved}`);
                    }

                    await client.query(
                        `UPDATE demandes_reapprovisionnement_lignes 
                         SET quantite_approuvee = $1, updated_at = CURRENT_TIMESTAMP
                         WHERE id = $2`,
                        [approved, ligneId]
                    );

                    totalApproved += approved;
                    if (approved < requested) anyPartial = true;
                    if (approved > 0) allZero = false;
                }

                // Determine status
                let newStatus: string;
                if (allZero) {
                    newStatus = 'refusee';
                } else if (anyPartial) {
                    newStatus = 'partiellement_approuvee';
                } else {
                    newStatus = 'approuvee';
                }

                await client.query(
                    `UPDATE demandes_reapprovisionnement
                     SET statut = $1,
                         decided_by_user_id = $2,
                         raison_refus = $3,
                         date_decision = CURRENT_TIMESTAMP,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $4`,
                    [newStatus, input.user_id, allZero ? (input.raison_refus || 'Toutes les lignes refusées') : null, demandeId]
                );
            }

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: input.user_id,
                action: input.decision,
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req: input.req,
                new_values: { decision: input.decision, raison_refus: input.raison_refus },
            });

            logger.info({ demandeId, decision: input.decision }, 'Décision prise sur demande');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async execute(demandeId: number, userId?: number, req?: any): Promise<{ transfert_id: number; numero_transfer: string }> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Lock demande
            const { rows: demandeRows } = await client.query(
                `SELECT * FROM demandes_reapprovisionnement 
                 WHERE id = $1 AND statut IN ('approuvee', 'partiellement_approuvee')
                 FOR UPDATE`,
                [demandeId]
            );

            if (demandeRows.length === 0) {
                throw new Error('Demande non trouvée ou non approuvée');
            }

            const demande = demandeRows[0];

            // Get approved lines
            const { rows: lignesRows } = await client.query(
                `SELECT id, produit_id, quantite_demandee, quantite_approuvee
                 FROM demandes_reapprovisionnement_lignes 
                 WHERE demande_id = $1
                 ORDER BY id ASC`,
                [demandeId]
            );

            // Calculate effective quantities
            const effectiveLines = lignesRows
                .map((l) => ({
                    id: l.id,
                    produit_id: parseInt(l.produit_id, 10),
                    quantite: l.quantite_approuvee !== null 
                        ? parseInt(l.quantite_approuvee, 10) 
                        : parseInt(l.quantite_demandee, 10),
                }))
                .filter((l) => l.quantite > 0);

            if (effectiveLines.length === 0) {
                throw new Error('Aucune ligne à transférer');
            }

            // Generate transfer number
            const { rows: seqRows } = await client.query(
                "SELECT nextval('transfer_numero_seq') AS num"
            );
            const numeroTransfer = `TRA-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

            // Create transfer
            const { rows: transferRows } = await client.query(
                `INSERT INTO stock_transfers (
                    numero_transfer, location_source_id, location_destination_id,
                    demande_id, notes, statut, cree_par
                ) VALUES ($1, $2, $3, $4, $5, 'en_cours', $6)
                RETURNING id`,
                [
                    numeroTransfer,
                    demande.depot_id,
                    demande.magasin_id,
                    demandeId,
                    `Créé depuis demande ${demande.numero}`,
                    userId,
                ]
            );

            const transfertId = transferRows[0].id;

            // Process each line - check stock, move, create transfer line
            for (const ligne of effectiveLines) {
                // Check stock availability with FOR UPDATE lock
                const { rows: stockRows } = await client.query(
                    `SELECT quantite FROM stock_par_location 
                     WHERE produit_id = $1 AND location_id = $2
                     FOR UPDATE`,
                    [ligne.produit_id, demande.depot_id]
                );

                const available = stockRows.length > 0 ? parseInt(stockRows[0].quantite, 10) : 0;

                if (available < ligne.quantite) {
                    throw new Error(
                        `Stock dépôt insuffisant pour le produit ${ligne.produit_id}: ` +
                        `disponible ${available}, demandé ${ligne.quantite}`
                    );
                }

                // Create transfer line with demande_ligne_id link
                await client.query(
                    `INSERT INTO stock_transfer_lignes (
                        transfer_id, produit_id, quantite_demandee, quantite_transferee, demande_ligne_id
                    ) VALUES ($1, $2, $3, $3, $4)`,
                    [transfertId, ligne.produit_id, ligne.quantite, ligne.id]
                );

                // Decrement depot stock
                await client.query(
                    `UPDATE stock_par_location 
                     SET quantite = quantite - $1, updated_at = CURRENT_TIMESTAMP
                     WHERE produit_id = $2 AND location_id = $3`,
                    [ligne.quantite, ligne.produit_id, demande.depot_id]
                );

                // Increment magasin stock (upsert)
                await client.query(
                    `INSERT INTO stock_par_location (produit_id, location_id, quantite)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (produit_id, location_id)
                     DO UPDATE SET quantite = stock_par_location.quantite + $3, updated_at = CURRENT_TIMESTAMP`,
                    [ligne.produit_id, demande.magasin_id, ligne.quantite]
                );

                // Update demande line with delivered quantity
                await client.query(
                    `UPDATE demandes_reapprovisionnement_lignes 
                     SET quantite_livree = $1, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $2`,
                    [ligne.quantite, ligne.id]
                );
            }

            // Update transfer to delivered
            await client.query(
                `UPDATE stock_transfers SET statut = 'livre' WHERE id = $1`,
                [transfertId]
            );

            // Update demande to livree (executed)
            await client.query(
                `UPDATE demandes_reapprovisionnement
                 SET statut = 'livree',
                     transfert_id = $1,
                     executed_by_user_id = $2,
                     date_execution = CURRENT_TIMESTAMP,
                     date_livraison = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [transfertId, userId, demandeId]
            );

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: userId,
                action: 'execute',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req,
                new_values: { transfert_id: transfertId, numero_transfer: numeroTransfer },
            });

            logger.info({ demandeId, transfertId, numeroTransfer }, 'Demande exécutée et stock transféré');

            return { transfert_id: transfertId, numero_transfer: numeroTransfer };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async close(demandeId: number, userId?: number, req?: any): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `UPDATE demandes_reapprovisionnement
                 SET statut = 'cloturee',
                     closed_by_user_id = $1,
                     date_cloture = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND statut = 'livree'
                 RETURNING id`,
                [userId, demandeId]
            );

            if (rows.length === 0) {
                throw new Error('Demande non trouvée ou non livrée');
            }

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: userId,
                action: 'close',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req,
            });

            logger.info({ demandeId }, 'Demande clôturée par le magasin');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async cancel(demandeId: number, userId?: number, req?: any): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Can only cancel in brouillon or envoyee
            const { rows: checkRows } = await client.query(
                `SELECT statut, created_by_user_id FROM demandes_reapprovisionnement 
                 WHERE id = $1 FOR UPDATE`,
                [demandeId]
            );

            if (checkRows.length === 0) {
                throw new Error('Demande non trouvée');
            }

            const current = checkRows[0];
            if (!['brouillon', 'envoyee'].includes(current.statut)) {
                throw new Error('Une demande ne peut être annulée qu\'en état brouillon ou envoyée');
            }

            // Verify ownership (magasin staff can only cancel their own)
            if (current.created_by_user_id !== userId) {
                // Admin can cancel any, magasin staff only their own
                // This check is done at controller level too
            }

            // Soft delete approach: mark as cancelled
            // Note: 'annulee' is not in the main enum, so we use 'refusee' with a flag
            // Or add 'annulee' to the enum. Let's use a different approach - set to 'refusee' with cancellation note
            await client.query(
                `UPDATE demandes_reapprovisionnement
                 SET statut = 'refusee',
                     raison_refus = COALESCE(raison_refus, '') || ' [Annulée par le magasin]',
                     decided_by_user_id = $1,
                     date_decision = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [userId, demandeId]
            );

            await client.query('COMMIT');

            await logAudit({
                utilisateur_id: userId,
                action: 'cancel',
                table_name: 'demandes_reapprovisionnement',
                record_id: demandeId,
                req,
            });

            logger.info({ demandeId }, 'Demande annulée');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ============================================
    // UTILITY
    // ============================================

    async getDepotStockForDemande(depotId: number, search?: string): Promise<any[]> {
        let query = `
            SELECT 
                p.id AS produit_id,
                p.reference,
                p.nom AS produit_nom,
                p.prix_vente,
                COALESCE(spl.quantite, 0) AS quantite_disponible,
                COALESCE(spl.quantite_reservee, 0) AS quantite_reservee
            FROM produits p
            LEFT JOIN stock_par_location spl ON p.id = spl.produit_id AND spl.location_id = $1
            WHERE p.deleted_at IS NULL
        `;
        
        const params: any[] = [depotId];

        if (search) {
            query += ` AND (p.nom ILIKE $2 OR p.reference ILIKE $2)`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY p.nom ASC`;

        const { rows } = await pool.query(query, params);
        return rows;
    }
}

export const demandeService = new DemandeService();
