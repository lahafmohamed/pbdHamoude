import { useAuth } from '../lib/AuthContext';

/**
 * Permission constants - mirror backend permissions
 */
export const Permissions = {
    // Stock
    STOCK_DEPOT_VIEW: 'stock:depot:view',
    STOCK_DEPOT_WRITE: 'stock:depot:write',
    STOCK_MAGASIN_VIEW: 'stock:magasin:view',
    STOCK_MAGASIN_WRITE: 'stock:magasin:write',

    // Demandes
    DEMANDE_CREATE: 'demande:create',
    DEMANDE_READ: 'demande:read',
    DEMANDE_UPDATE: 'demande:update',
    DEMANDE_SEND: 'demande:send',
    DEMANDE_DECIDE: 'demande:decide',
    DEMANDE_CANCEL: 'demande:cancel',
    DEMANDE_EXECUTE: 'demande:execute',
    DEMANDE_CLOSE: 'demande:close',

    // Transferts
    TRANSFERT_CREATE: 'transfert:create',
    TRANSFERT_CREATE_PROACTIVE: 'transfert:create:proactive',
    TRANSFERT_READ: 'transfert:read',
    TRANSFERT_EXECUTE: 'transfert:execute',
    TRANSFERT_CANCEL: 'transfert:cancel',

    // Ventes
    FACTURE_CREATE: 'facture:create',
    DEVIS_CREATE: 'devis:create',

    // Admin
    ADMIN_FULL: 'admin:full',
} as const;

export type Permission = typeof Permissions[keyof typeof Permissions];

/**
 * Role-based permission matrix (mirror of backend)
 */
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
    admin: Object.values(Permissions),
    depot_staff: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_DEPOT_WRITE,
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_DECIDE,
        Permissions.DEMANDE_EXECUTE,
        Permissions.TRANSFERT_CREATE_PROACTIVE,
        Permissions.TRANSFERT_READ,
        Permissions.TRANSFERT_EXECUTE,
    ],
    magasin_staff: [
        Permissions.STOCK_DEPOT_VIEW,
        Permissions.STOCK_MAGASIN_VIEW,
        Permissions.STOCK_MAGASIN_WRITE,
        Permissions.DEMANDE_CREATE,
        Permissions.DEMANDE_READ,
        Permissions.DEMANDE_UPDATE,
        Permissions.DEMANDE_SEND,
        Permissions.DEMANDE_CANCEL,
        Permissions.DEMANDE_CLOSE,
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

/**
 * Hook for checking permissions based on user's role
 */
export function usePermission() {
    const { user } = useAuth();

    const userRole = user?.role || '';
    const userPermissions = ROLE_PERMISSIONS[userRole] || [];

    /**
     * Check if user has specific permission
     */
    const hasPermission = (permission: Permission): boolean => {
        return userPermissions.includes(permission);
    };

    /**
     * Check if user has ANY of the specified permissions
     */
    const hasAnyPermission = (...permissions: Permission[]): boolean => {
        return permissions.some((p) => userPermissions.includes(p));
    };

    /**
     * Check if user has ALL specified permissions
     */
    const hasAllPermissions = (...permissions: Permission[]): boolean => {
        return permissions.every((p) => userPermissions.includes(p));
    };

    /**
     * Check location type access
     */
    const canAccessLocation = (locationType: 'depot' | 'magasin', accessLevel: 'read' | 'write' = 'read'): boolean => {
        if (userRole === 'admin') return true;

        if (locationType === 'depot') {
            if (accessLevel === 'write') {
                return ['depot_staff', 'admin', 'manager'].includes(userRole);
            }
            return ['depot_staff', 'admin', 'manager', 'magasin_staff', 'viewer'].includes(userRole);
        }

        if (locationType === 'magasin') {
            if (accessLevel === 'write') {
                return ['magasin_staff', 'admin', 'manager', 'caissier'].includes(userRole);
            }
            return ['magasin_staff', 'admin', 'manager', 'caissier', 'depot_staff', 'viewer'].includes(userRole);
        }

        return false;
    };

    /**
     * Get UI state for an action (visible, disabled, tooltip)
     */
    const getActionState = (permission: Permission, fallbackTooltip?: string): {
        visible: boolean;
        disabled: boolean;
        tooltip: string | null;
    } => {
        const hasPerm = hasPermission(permission);

        if (!hasPerm) {
            return {
                visible: true, // Show disabled rather than hiding
                disabled: true,
                tooltip: fallbackTooltip || 'Vous n\'avez pas les droits pour cette action',
            };
        }

        return {
            visible: true,
            disabled: false,
            tooltip: null,
        };
    };

    return {
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        canAccessLocation,
        getActionState,
        userRole,
        userPermissions,
    };
}

export default usePermission;
