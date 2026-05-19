import { Request, Response } from 'express';
import { demandeService } from '../services/DemandeService';
import { successResponse, paginatedResponse } from '../utils/response';
import { AuthRequest } from '../middleware/auth';
import { getUserLocationRole } from '../middleware/permissions';
import pool from '../db/connection';

export class DemandeController {
    // ============================================
    // LIST - Role-based filtering
    // ============================================

    static async getAll(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { statut, magasin_id, depot_id, date_from, date_to, page, limit } = req.query;
            const userId = req.user?.id;
            const userRole = req.user?.role;

            if (!userId || !userRole) {
                res.status(401).json({ success: false, error: 'Non authentifié' });
                return;
            }

            // Build filters based on role
            let filters: any = {
                statut: statut as string | undefined,
                page: page ? parseInt(page as string, 10) : 1,
                limit: limit ? parseInt(limit as string, 10) : 20,
            };

            if (date_from) filters.date_from = new Date(date_from as string);
            if (date_to) filters.date_to = new Date(date_to as string);

            // Role-based filtering
            if (userRole === 'admin') {
                // Admin sees all, can filter by magasin/depot explicitly
                if (magasin_id) filters.magasin_id = parseInt(magasin_id as string, 10);
                if (depot_id) filters.depot_id = parseInt(depot_id as string, 10);
            } else if (userRole === 'magasin_staff') {
                // Magasin staff: see demandes they created or for their assigned magasin
                const assignedMagasins = await pool.query(
                    `SELECT location_id FROM user_location_roles 
                     WHERE utilisateur_id = $1 AND role_at_location IN ('magasin_staff', 'both')`,
                    [userId]
                );
                
                if (assignedMagasins.rows.length > 0) {
                    const magasinIds = assignedMagasins.rows.map((r) => r.location_id);
                    // Filter by their magasins OR their created demandes
                    filters.magasin_id_override = magasinIds;
                    filters.created_by_user_id = userId;
                } else {
                    // Fallback: only see their own demandes
                    filters.created_by_user_id = userId;
                }
            } else if (userRole === 'depot_staff') {
                // Depot staff: see demandes sent to their assigned depot
                const assignedDepots = await pool.query(
                    `SELECT location_id FROM user_location_roles 
                     WHERE utilisateur_id = $1 AND role_at_location IN ('depot_staff', 'both')`,
                    [userId]
                );
                
                if (assignedDepots.rows.length > 0) {
                    const depotIds = assignedDepots.rows.map((r) => r.location_id);
                    // Default filter: only 'envoyee' and later states (not brouillon)
                    if (!statut) {
                        // If no explicit statut filter, default to actionable ones
                        filters.statut_in = ['envoyee', 'approuvee', 'partiellement_approuvee', 'en_cours', 'livree'];
                    }
                    filters.depot_id_override = depotIds;
                } else {
                    // No depot access - empty result
                    paginatedResponse(res, [], 0, 1, 20, 'Demandes récupérées avec succès');
                    return;
                }
            }

            // For depot staff, handle the override
            let query = `
                SELECT d.*,
                       m.nom AS magasin_nom, m.code AS magasin_code,
                       dp.nom AS depot_nom, dp.code AS depot_code,
                       u1.username AS created_by_username, u1.nom_complet AS created_by_nom,
                       u2.username AS decided_by_username, u2.nom_complet AS decided_by_nom,
                       st.numero_transfer
                FROM demandes_reapprovisionnement d
                JOIN stock_locations m ON d.magasin_id = m.id
                JOIN stock_locations dp ON d.depot_id = dp.id
                LEFT JOIN utilisateurs u1 ON d.created_by_user_id = u1.id
                LEFT JOIN utilisateurs u2 ON d.decided_by_user_id = u2.id
                LEFT JOIN stock_transfers st ON d.transfert_id = st.id
                WHERE 1=1
            `;
            const params: any[] = [];

            // Apply filters
            if (filters.statut) {
                query += ` AND d.statut = $${params.length + 1}`;
                params.push(filters.statut);
            }
            if (filters.statut_in) {
                query += ` AND d.statut = ANY($${params.length + 1})`;
                params.push(filters.statut_in);
            }
            if (filters.magasin_id) {
                query += ` AND d.magasin_id = $${params.length + 1}`;
                params.push(filters.magasin_id);
            }
            if (filters.magasin_id_override && !filters.created_by_user_id) {
                query += ` AND d.magasin_id = ANY($${params.length + 1})`;
                params.push(filters.magasin_id_override);
            }
            if (filters.depot_id) {
                query += ` AND d.depot_id = $${params.length + 1}`;
                params.push(filters.depot_id);
            }
            if (filters.depot_id_override) {
                query += ` AND d.depot_id = ANY($${params.length + 1})`;
                params.push(filters.depot_id_override);
            }
            if (filters.created_by_user_id && filters.magasin_id_override) {
                // Both: OR condition
                query += ` AND (d.created_by_user_id = $${params.length + 1} OR d.magasin_id = ANY($${params.length + 2}))`;
                params.push(filters.created_by_user_id, filters.magasin_id_override);
            } else if (filters.created_by_user_id) {
                query += ` AND d.created_by_user_id = $${params.length + 1}`;
                params.push(filters.created_by_user_id);
            }

            // Count query
            let countQuery = `SELECT COUNT(*) as total FROM demandes_reapprovisionnement d WHERE 1=1`;
            const countParams: any[] = [];
            
            if (filters.statut) {
                countQuery += ` AND d.statut = $${countParams.length + 1}`;
                countParams.push(filters.statut);
            }
            if (filters.statut_in) {
                countQuery += ` AND d.statut = ANY($${countParams.length + 1})`;
                countParams.push(filters.statut_in);
            }
            if (filters.magasin_id) {
                countQuery += ` AND d.magasin_id = $${countParams.length + 1}`;
                countParams.push(filters.magasin_id);
            }
            if (filters.magasin_id_override && !filters.created_by_user_id) {
                countQuery += ` AND d.magasin_id = ANY($${countParams.length + 1})`;
                countParams.push(filters.magasin_id_override);
            }
            if (filters.depot_id) {
                countQuery += ` AND d.depot_id = $${countParams.length + 1}`;
                countParams.push(filters.depot_id);
            }
            if (filters.depot_id_override) {
                countQuery += ` AND d.depot_id = ANY($${countParams.length + 1})`;
                countParams.push(filters.depot_id_override);
            }
            if (filters.created_by_user_id && filters.magasin_id_override) {
                countQuery += ` AND (d.created_by_user_id = $${countParams.length + 1} OR d.magasin_id = ANY($${countParams.length + 2}))`;
                countParams.push(filters.created_by_user_id, filters.magasin_id_override);
            } else if (filters.created_by_user_id) {
                countQuery += ` AND d.created_by_user_id = $${countParams.length + 1}`;
                countParams.push(filters.created_by_user_id);
            }

            // Pagination
            query += ' ORDER BY d.date_creation DESC';
            query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(filters.limit, (filters.page - 1) * filters.limit);

            const [{ rows }, { rows: countRows }] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, countParams),
            ]);

            const total = parseInt(countRows[0].total, 10);

            paginatedResponse(res, rows, total, filters.page, filters.limit, 'Demandes récupérées avec succès');
        } catch (error: any) {
            console.error('[DemandeController.getAll] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ============================================
    // GET BY ID
    // ============================================

    static async getById(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const userRole = req.user?.role;

            const demande = await demandeService.getById(id);

            if (!demande) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            // Role-based access check
            if (userRole === 'admin') {
                // Full access
            } else if (userRole === 'magasin_staff') {
                // Can access if creator or assigned to this magasin
                const canAccess = demande.created_by_user_id === userId || 
                    await getUserLocationRole(userId!, demande.magasin_id) !== 'none';
                
                if (!canAccess) {
                    res.status(403).json({ success: false, error: 'Accès refusé à cette demande' });
                    return;
                }
            } else if (userRole === 'depot_staff') {
                // Can access if assigned to this depot
                const depotAccess = await getUserLocationRole(userId!, demande.depot_id);
                if (depotAccess === 'none') {
                    res.status(403).json({ success: false, error: 'Accès refusé à cette demande' });
                    return;
                }
                // Depot staff cannot see brouillon demandes from magasins
                if (demande.statut === 'brouillon') {
                    res.status(403).json({ success: false, error: 'Cette demande n\'est pas encore visible' });
                    return;
                }
            } else {
                res.status(403).json({ success: false, error: 'Permissions insuffisantes' });
                return;
            }

            successResponse(res, demande, 'Demande récupérée avec succès');
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ============================================
    // CREATE
    // ============================================

    static async create(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { magasin_id, depot_id, lignes, motif } = req.body;
            const userId = req.user?.id;

            if (!magasin_id || !depot_id || !lignes || !Array.isArray(lignes) || lignes.length === 0) {
                res.status(400).json({ 
                    success: false, 
                    error: 'magasin_id, depot_id et lignes (non vide) sont requis' 
                });
                return;
            }

            const result = await demandeService.create({
                magasin_id,
                depot_id,
                lignes,
                motif,
                created_by_user_id: userId,
                req,
            });

            res.status(201).json({
                success: true,
                data: result,
                message: 'Demande créée avec succès',
            });
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    // ============================================
    // UPDATE (brouillon only)
    // ============================================

    static async update(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const { lignes, motif } = req.body;
            const userId = req.user?.id;
            const userRole = req.user?.role;

            // Check ownership before update
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            if (existing.created_by_user_id !== userId && userRole !== 'admin') {
                res.status(403).json({ success: false, error: 'Vous ne pouvez modifier que vos propres demandes en brouillon' });
                return;
            }

            await demandeService.update(id, { lignes, motif }, userId);
            successResponse(res, null, 'Demande mise à jour avec succès');
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    // ============================================
    // STATE TRANSITIONS
    // ============================================

    static async send(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const userRole = req.user?.role;

            // Verify ownership
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            if (existing.created_by_user_id !== userId && userRole !== 'admin') {
                res.status(403).json({ success: false, error: 'Vous ne pouvez envoyer que vos propres demandes' });
                return;
            }

            await demandeService.send(id, userId, req);
            successResponse(res, null, 'Demande envoyée au dépôt avec succès');
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    static async decide(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const { decision, lignes_decision, raison_refus } = req.body;
            const userId = req.user?.id;
            const userRole = req.user?.role;

            if (!decision || !['approuvee', 'refusee'].includes(decision)) {
                res.status(400).json({ success: false, error: 'Décision requise: approuvee ou refusee' });
                return;
            }

            // Verify depot access
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            if (userRole !== 'admin') {
                const depotAccess = await getUserLocationRole(userId!, existing.depot_id);
                if (depotAccess === 'none') {
                    res.status(403).json({ success: false, error: 'Seul le personnel du dépôt concerné peut décider' });
                    return;
                }
            }

            // Validate partial approval requires line decisions
            if (decision === 'approuvee' && lignes_decision) {
                // Check if any line is partial
                const isPartial = lignes_decision.some((ld: any) => {
                    const line = existing.lignes.find((l: any) => l.id === ld.ligne_id);
                    return line && ld.quantite_approuvee < line.quantite_demandee;
                });

                // If partial, reject this request - client should handle partial properly
                if (isPartial) {
                    // Actually, the service handles this - let it through
                }
            }

            // Refusal requires reason
            if (decision === 'refusee' && !raison_refus) {
                res.status(400).json({ success: false, error: 'Motif de refus requis' });
                return;
            }

            await demandeService.decide(id, {
                decision,
                lignes_decision,
                raison_refus,
                user_id: userId,
                req,
            });

            const message = decision === 'approuvee' 
                ? 'Demande approuvée avec succès' 
                : 'Demande refusée';
            
            successResponse(res, null, message);
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    static async execute(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const userRole = req.user?.role;

            // Verify depot access
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            if (userRole !== 'admin') {
                const depotAccess = await getUserLocationRole(userId!, existing.depot_id);
                if (depotAccess === 'none') {
                    res.status(403).json({ 
                        success: false, 
                        error: 'Seul le personnel du dépôt peut exécuter les transferts' 
                    });
                    return;
                }
            }

            const result = await demandeService.execute(id, userId, req);
            
            res.status(200).json({
                success: true,
                data: result,
                message: 'Transfert exécuté avec succès',
            });
        } catch (error: any) {
            // Check for stock insufficiency message
            if (error.message.includes('Stock dépôt insuffisant')) {
                res.status(422).json({ success: false, error: error.message });
                return;
            }
            res.status(400).json({ success: false, error: error.message });
        }
    }

    static async close(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const userRole = req.user?.role;

            // Verify magasin access
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            if (userRole !== 'admin') {
                const magasinAccess = await getUserLocationRole(userId!, existing.magasin_id);
                if (magasinAccess === 'none') {
                    res.status(403).json({ 
                        success: false, 
                        error: 'Seul le personnel du magasin peut clôturer' 
                    });
                    return;
                }
            }

            await demandeService.close(id, userId, req);
            successResponse(res, null, 'Demande clôturée avec succès');
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    static async cancel(req: AuthRequest, res: Response): Promise<void> {
        try {
            const id = parseInt(req.params.id, 10);
            const userId = req.user?.id;
            const userRole = req.user?.role;

            // Verify ownership
            const existing = await demandeService.getById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            // Only creator or admin can cancel
            if (existing.created_by_user_id !== userId && userRole !== 'admin') {
                res.status(403).json({ success: false, error: 'Vous ne pouvez annuler que vos propres demandes' });
                return;
            }

            // Can only cancel in brouillon or envoyee
            if (!['brouillon', 'envoyee'].includes(existing.statut)) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Une demande ne peut être annulée qu\'en état brouillon ou envoyée' 
                });
                return;
            }

            await demandeService.cancel(id, userId, req);
            successResponse(res, null, 'Demande annulée avec succès');
        } catch (error: any) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    // ============================================
    // DEPOT STOCK VIEW (for magasin planning)
    // ============================================

    static async getDepotStock(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { depot_id, search } = req.query;
            const userRole = req.user?.role;

            if (!depot_id) {
                res.status(400).json({ success: false, error: 'depot_id requis' });
                return;
            }

            // All authenticated users can view depot stock (read-only)
            // Actual write protection is at the mutation level
            const stock = await demandeService.getDepotStockForDemande(
                parseInt(depot_id as string, 10),
                search as string | undefined
            );

            successResponse(res, stock, 'Stock dépôt récupéré avec succès');
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}
