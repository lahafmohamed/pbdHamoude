import React from 'react';
import { usePermission, Permission } from '../hooks/usePermission';

interface RequirePermissionProps {
    permission: Permission;
    children: React.ReactNode;
    fallback?: React.ReactNode;
    hideIfUnauthorized?: boolean;
}

/**
 * Component that conditionally renders children based on user permission
 * 
 * Usage:
 * <RequirePermission permission={Permissions.DEMANDE_CREATE}>
 *   <Button>Nouvelle Demande</Button>
 * </RequirePermission>
 * 
 * With fallback:
 * <RequirePermission 
 *   permission={Permissions.DEMANDE_CREATE}
 *   fallback={<span>Vous ne pouvez pas créer de demandes</span>}
 * >
 *   <Button>Nouvelle Demande</Button>
 * </RequirePermission>
 * 
 * Hide completely if unauthorized:
 * <RequirePermission permission={Permissions.DEMANDE_CREATE} hideIfUnauthorized>
 *   <Button>Nouvelle Demande</Button>
 * </RequirePermission>
 */
export function RequirePermission({
    permission,
    children,
    fallback,
    hideIfUnauthorized = false,
}: RequirePermissionProps) {
    const { hasPermission } = usePermission();

    if (!hasPermission(permission)) {
        if (hideIfUnauthorized) {
            return null;
        }
        return <>{fallback || null}</>;
    }

    return <>{children}</>;
}

interface RequireAnyPermissionProps {
    permissions: Permission[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
    hideIfUnauthorized?: boolean;
}

/**
 * Component that renders if user has ANY of the specified permissions
 */
export function RequireAnyPermission({
    permissions,
    children,
    fallback,
    hideIfUnauthorized = false,
}: RequireAnyPermissionProps) {
    const { hasAnyPermission } = usePermission();

    if (!hasAnyPermission(...permissions)) {
        if (hideIfUnauthorized) {
            return null;
        }
        return <>{fallback || null}</>;
    }

    return <>{children}</>;
}

interface RequireAllPermissionsProps {
    permissions: Permission[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
    hideIfUnauthorized?: boolean;
}

/**
 * Component that renders only if user has ALL specified permissions
 */
export function RequireAllPermissions({
    permissions,
    children,
    fallback,
    hideIfUnauthorized = false,
}: RequireAllPermissionsProps) {
    const { hasAllPermissions } = usePermission();

    if (!hasAllPermissions(...permissions)) {
        if (hideIfUnauthorized) {
            return null;
        }
        return <>{fallback || null}</>;
    }

    return <>{children}</>;
}

interface RequireLocationAccessProps {
    locationType: 'depot' | 'magasin';
    accessLevel?: 'read' | 'write';
    children: React.ReactNode;
    fallback?: React.ReactNode;
    hideIfUnauthorized?: boolean;
}

/**
 * Component that renders based on location type access
 */
export function RequireLocationAccess({
    locationType,
    accessLevel = 'read',
    children,
    fallback,
    hideIfUnauthorized = false,
}: RequireLocationAccessProps) {
    const { canAccessLocation } = usePermission();

    if (!canAccessLocation(locationType, accessLevel)) {
        if (hideIfUnauthorized) {
            return null;
        }
        return (
            <>
                {fallback || (
                    <div className="p-4 bg-muted rounded-lg text-muted-foreground text-sm">
                        Vue en lecture seule — vous n&apos;avez pas accès à la modification du {locationType === 'depot' ? 'dépôt' : 'magasin'}.
                    </div>
                )}
            </>
        );
    }

    return <>{children}</>;
}

/**
 * Higher-order component for wrapping pages/components with permission check
 */
export function withPermission<P extends object>(
    Component: React.ComponentType<P>,
    permission: Permission,
    fallback?: React.ReactNode
) {
    return function WithPermissionWrapper(props: P) {
        return (
            <RequirePermission permission={permission} fallback={fallback}>
                <Component {...props} />
            </RequirePermission>
        );
    };
}

export default RequirePermission;
