import { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { AuthRequest } from './auth';

// ============================================
// ACTION CONSTANTS - Permission granularity
// ============================================

export const Permissions = {
    // Stock - Depot
    STOCK_DEPOT_VIEW: 'stock:depot:view',
    STOCK_DEPOT_WRITE: 'stock:depot:write', // entree, ajustement, transfert sortant
    STOCK_DEPOT_MUTATE: 'stock:depot:mutate', // Legacy alias

    // Stock - Magasin
    STOCK_MAGASIN_VIEW: 'stock:magasin:view',
    STOCK_MAGASIN_WRITE: 'stock:magasin:write', // entree from transfert, ajustement, sortie via Factures
    STOCK_MAGASIN_MUTATE: 'stock:magasin:mutate', // Legacy alias

    // Demandes de Réapprovisionnement
    DEMANDE_CREATE: 'demande:create',
    DEMANDE_READ: 'demande:read',
    DEMANDE_UPDATE: 'demande:update', // Edit brouillon
    DEMANDE_SEND: 'demande:send', // Brouillon -> Envoyee
    DEMANDE_DECIDE: 'demande:decide', // Approve/Reject
    DEMANDE_CANCEL: 'demande:cancel', // Cancel brouillon/envoyee
    DEMANDE_EXECUTE: 'demande:execute', // Create transfer from approved demande
    DEMANDE_CLOSE: 'demande:close', // Magasin confirms receipt

    // Transferts
    TRANSFERT_CREATE: 'transfert:create',
    TRANSFERT_CREATE_PROACTIVE: 'transfert:create:proactive', // Depot-initiated without demande
    TRANSFERT_READ: 'transfert:read',
    TRANSFERT_EXECUTE: 'transfert:execute', // Complete the transfer (move stock)
    TRANSFERT_CANCEL: 'transfert:cancel',

    // Ventes (existing)
    FACTURE_CREATE: 'facture:create',
    DEVIS_CREATE: 'devis:create',

    // Admin
    ADMIN_FULL: 'admin:full',
} as const;

export type Permission = typeof Permissions[keyof typeof Permissions];

// ============================================
// ROLE-PERMISSION MATRIX
// ============================================

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
    admin: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_DEPOT_WRITE,
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.STOCK_MAGASIN_WRITE,
        Permissions.DEMANDE_CREATE,
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_UPDATE,
        Permissions.DEMANDE_SEND,
        Permissions.DEMANDE_DECIDE,
        Permissions.DEMANDE_CANCEL,
        Permissions.DEMANDE_EXECUTE,
        Permissions.DEMANDE_CLOSE,
        Permissions.TRANSFERT_CREATE,
        Permissions.TRANSFERT_CREATE_PROACTIVE,
        Permissions.TRANSFERT_READ,
        Permissions.TRANSFERT_EXECUTE,
        Permissions.TRANSFERT_CANCEL,
        Permissions.FACTURE_CREATE,
        Permissions.DEVIS_CREATE,
        Permissions.ADMIN_FULL,
    ],
    depot_staff: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_DEPOT_WRITE,
        Permissions.STOCK_MAGASIN_VIEW, // Read-only
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_DECIDE, // Approve/reject
        Permissions.DEMANDE_EXECUTE, // Create transfer from demande
        Permissions.TRANSFERT_CREATE_PROACTIVE, // Proactive depot→magasin
        Permissions.TRANSFERT_READ,
        Permissions.TRANSFERT_EXECUTE,
    ],
    magasin_staff: [
        Permissions.STOCK_DEPOT_VIEW, // Read-only for planning
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.STOCK_MAGASIN_WRITE,
        Permissions.DEMANDE_CREATE,
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_UPDATE,
        Permissions.DEMANDE_SEND,
        Permissions.DEMANDE_CANCEL,
        Permissions.DEMANDE_CLOSE, // Confirm receipt
        Permissions.TRANSFERT_READ,
        Permissions.FACTURE_CREATE,
        Permissions.DEVIS_CREATE,
    ],
    viewer: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.DEMANDE_READ,
        Permissions.TRANSFERT_READ,
    ],
    // Legacy roles - mapped conservatively
    manager: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_DEPOT_WRITE,
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.STOCK_MAGASIN_WRITE,
        Permissions.DEMANDE_CREATE,
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_DECIDE,
        Permissions.DEMANDE_EXECUTE,
        Permissions.TRANSFERT_CREATE,
        Permissions.TRANSFERT_CREATE_PROACTIVE,
        Permissions.TRANSFERT_READ,
        Permissions.TRANSFERT_EXECUTE,
        Permissions.FACTURE_CREATE,
        Permissions.DEVIS_CREATE,
    ],
    caissier: [
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.STOCK_MAGASIN_WRITE,
        Permissions.DEMANDE_CREATE,
        Permissions.DEMANDE_READ,
        Permissions.TRANSFERT_READ,
        Permissions.FACTURE_CREATE,
        Permissions.DEVIS_CREATE,
    ],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a user role has a specific permission
 */
export function hasPermission(role: string, permission: Permission): boolean {
    const permissions = ROLE_PERMISSIONS[role] || [];
    return permissions.includes(permission);
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: string): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if user can access a specific location type
 */
export async function canAccessLocationType(
    userId: number,
    userRole: string,
    locationType: 'depot' | 'magasin',
    accessLevel: 'read' | 'write' = 'read'
): Promise<boolean> {
    // Admin has full access
    if (userRole === 'admin') return true;

    // Check role compatibility
    if (locationType === 'depot') {
        if (accessLevel === 'write') {
            return ['depot_staff', 'admin', 'manager'].includes(userRole);
        }
        // Read: depot_staff has write implicitly, others need explicit
        return ['depot_staff', 'admin', 'manager', 'magasin_staff', 'viewer'].includes(userRole);
    }

    if (locationType === 'magasin') {
        if (accessLevel === 'write') {
            return ['magasin_staff', 'admin', 'manager', 'caissier'].includes(userRole);
        }
        // Read: all except maybe very restricted
        return ['magasin_staff', 'admin', 'manager', 'caissier', 'depot_staff', 'viewer'].includes(userRole);
    }

    return false;
}

/**
 * Check if user has specific role at a location
 */
export async function getUserLocationRole(
    userId: number,
    locationId: number
): Promise<'depot_staff' | 'magasin_staff' | 'both' | 'none'> {
    try {
        // Check user_location_roles first (canonical)
        const { rows } = await pool.query(
            `SELECT role_at_location FROM user_location_roles 
             WHERE utilisateur_id = $1 AND location_id = $2`,
            [userId, locationId]
        );

        if (rows.length > 0) {
            return rows[0].role_at_location;
        }

        // Fallback: check utilisateur_locations with location_type inference
        const { rows: fallbackRows } = await pool.query(
            `SELECT ul.location_id, sl.location_type
             FROM utilisateur_locations ul
             JOIN stock_locations sl ON ul.location_id = sl.id
             WHERE ul.utilisateur_id = $1 AND ul.location_id = $2`,
            [userId, locationId]
        );

        if (fallbackRows.length > 0) {
            const locationType = fallbackRows[0].location_type;
            return locationType === 'depot' ? 'depot_staff' : 'magasin_staff';
        }

        return 'none';
    } catch {
        return 'none';
    }
}

// ============================================
// MIDDLEWARE FACTORIES
// ============================================

/**
 * Middleware: Require specific permission(s)
 * Usage: router.post('/', requirePermission(Permissions.DEMANDE_CREATE), handler)
 */
export function requirePermission(...requiredPermissions: Permission[]) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        const userRole = req.user?.role;

        if (!userRole) {
            res.status(401).json({
                success: false,
                error: 'Non authentifié',
            });
            return;
        }

        // Check if user has ANY of the required permissions
        const hasAnyPermission = requiredPermissions.some((perm) =>
            hasPermission(userRole, perm)
        );

        if (!hasAnyPermission) {
            res.status(403).json({
                success: false,
                error: 'Permissions insuffisantes. Vous n\'avez pas les droits nécessaires pour cette action.',
                required: requiredPermissions,
                currentRole: userRole,
            });
            return;
        }

        next();
    };
}

/**
 * Middleware: Require all specified permissions
 */
export function requireAllPermissions(...requiredPermissions: Permission[]) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        const userRole = req.user?.role;

        if (!userRole) {
            res.status(401).json({
                success: false,
                error: 'Non authentifié',
            });
            return;
        }

        const missingPermissions = requiredPermissions.filter(
            (perm) => !hasPermission(userRole, perm)
        );

        if (missingPermissions.length > 0) {
            res.status(403).json({
                success: false,
                error: 'Permissions insuffisantes. Droits manquants: ' + missingPermissions.join(', '),
                missing: missingPermissions,
                currentRole: userRole,
            });
            return;
        }

        next();
    };
}

/**
 * Middleware: Check location type access
 * Must be used AFTER authenticate middleware
 */
export function requireLocationAccess(
    locationType: 'depot' | 'magasin',
    accessLevel: 'read' | 'write' = 'read'
) {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.user?.id;
        const userRole = req.user?.role;

        if (!userId || !userRole) {
            res.status(401).json({
                success: false,
                error: 'Non authentifié',
            });
            return;
        }

        const canAccess = await canAccessLocationType(userId, userRole, locationType, accessLevel);

        if (!canAccess) {
            const locationLabel = locationType === 'depot' ? 'dépôt' : 'magasin';
            const actionLabel = accessLevel === 'write' ? 'modifier' : 'voir';
            
            res.status(403).json({
                success: false,
                error: `Vous n'avez pas les droits pour ${actionLabel} le stock ${locationLabel}. Contactez le responsable.`,
                locationType,
                accessLevel,
                currentRole: userRole,
            });
            return;
        }

        next();
    };
}

/**
 * Middleware: Check if user owns/is associated with a demande resource
 * For magasin_staff: can only access demandes they created or for their assigned magasin
 * For depot_staff: can access demandes sent to their assigned depot
 */
export function requireDemandeOwnershipOrRole(allowedRoles: string[] = ['admin']) {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const demandeId = parseInt(req.params.id, 10);

        if (!userId || !userRole) {
            res.status(401).json({ success: false, error: 'Non authentifié' });
            return;
        }

        // Admin or explicitly allowed roles bypass ownership check
        if (allowedRoles.includes(userRole)) {
            next();
            return;
        }

        try {
            // Get demande details
            const { rows } = await pool.query(
                `SELECT d.created_by_user_id, d.magasin_id, d.depot_id, 
                        sl_mag.location_type as magasin_type,
                        sl_dep.location_type as depot_type
                 FROM demandes_reapprovisionnement d
                 JOIN stock_locations sl_mag ON d.magasin_id = sl_mag.id
                 JOIN stock_locations sl_dep ON d.depot_id = sl_dep.id
                 WHERE d.id = $1`,
                [demandeId]
            );

            if (rows.length === 0) {
                res.status(404).json({ success: false, error: 'Demande non trouvée' });
                return;
            }

            const demande = rows[0];

            // Magasin staff: can access if they created it OR if it's for their magasin
            if (userRole === 'magasin_staff') {
                const isCreator = demande.created_by_user_id === userId;
                
                // Check if user is assigned to this magasin
                const userMagasinRole = await getUserLocationRole(userId, demande.magasin_id);
                const isAssigned = ['magasin_staff', 'both'].includes(userMagasinRole);

                if (isCreator || isAssigned) {
                    next();
                    return;
                }
            }

            // Depot staff: can access if it's sent to their depot
            if (userRole === 'depot_staff') {
                const userDepotRole = await getUserLocationRole(userId, demande.depot_id);
                const isAssigned = ['depot_staff', 'both'].includes(userDepotRole);

                if (isAssigned) {
                    next();
                    return;
                }
            }

            res.status(403).json({
                success: false,
                error: 'Vous n\'avez pas accès à cette demande.',
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'Erreur de vérification des permissions',
            });
        }
    };
}

// ============================================
// DEBUG/DEVELOPMENT HELPER
// ============================================

/**
 * Middleware for development: logs permission checks
 */
export function debugPermissions(req: AuthRequest, res: Response, next: NextFunction): void {
    const userRole = req.user?.role;
    if (userRole) {
        const perms = getRolePermissions(userRole);
        console.log(`[DEBUG] User ${req.user?.username} (${userRole}) has permissions:`, perms);
    }
    next();
}
