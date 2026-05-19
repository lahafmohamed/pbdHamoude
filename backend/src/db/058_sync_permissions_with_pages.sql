-- Migration: Sync permissions with actual program pages
-- Purpose: Replace demo/legacy permissions with real ones matching App.tsx routes & Navbar.

BEGIN;

-- 1. Purge legacy/demo permissions (cascades to role_permissions and user_permissions)
DELETE FROM permissions WHERE code IN (
    -- Old basic seeds (056)
    'inventory.read', 'inventory.write',
    'sales.create', 'sales.read',
    'purchases.create', 'purchases.read',
    'roles.manage',
    -- Demo seeds (057)
    'pesees.read', 'pesees.read.prices', 'pesees.write', 'pesees.delete', 'pesees.exclude',
    'sorties.read', 'sorties.read.prices', 'sorties.write.livraisons',
    'tickets.read', 'tickets.read.prices', 'tickets.write', 'tickets.bulk.edit',
    'paiements.read', 'paiements.read.prices', 'paiements.write'
);

-- 2. Insert real permissions matching the actual pages
INSERT INTO permissions (code, nom, description, module) VALUES
-- Dashboard
('dashboard.read', 'Accéder au tableau de bord', 'Voir le tableau de bord principal', 'Dashboard'),

-- Inventaire (Stock)
('inventaire.read', 'Voir l''inventaire', 'Consulter l''inventaire des produits', 'Inventaire'),
('inventaire.write', 'Modifier l''inventaire', 'Ajuster les quantités de stock', 'Inventaire'),

-- Ventes
('factures.read', 'Voir les factures', 'Consulter les factures clients', 'Ventes'),
('factures.create', 'Créer une facture', 'Émettre une nouvelle facture', 'Ventes'),
('devis.read', 'Voir les devis', 'Consulter les devis', 'Ventes'),
('devis.create', 'Créer un devis', 'Émettre un nouveau devis', 'Ventes'),
('bons_livraison.read', 'Voir les bons de livraison', 'Consulter les bons de livraison', 'Ventes'),
('bons_livraison.create', 'Créer un bon de livraison', 'Émettre un nouveau bon de livraison', 'Ventes'),
('avoirs.read', 'Voir les avoirs', 'Consulter les avoirs', 'Ventes'),
('avoirs.create', 'Créer un avoir', 'Émettre un nouvel avoir', 'Ventes'),

-- Achats
('commandes.read', 'Voir les commandes', 'Consulter les commandes fournisseur', 'Achats'),
('commandes.create', 'Créer une commande', 'Émettre une nouvelle commande fournisseur', 'Achats'),
('receptions.read', 'Voir les réceptions', 'Consulter les réceptions', 'Achats'),
('receptions.create', 'Créer une réception', 'Enregistrer une nouvelle réception', 'Achats'),
('factures_fournisseur.read', 'Voir les factures fournisseur', 'Consulter les factures fournisseur', 'Achats'),
('factures_fournisseur.create', 'Créer une facture fournisseur', 'Enregistrer une facture fournisseur', 'Achats'),

-- Tiers
('tiers.read', 'Voir les tiers', 'Consulter clients et fournisseurs', 'Tiers'),
('clients.read', 'Voir les clients', 'Consulter la liste des clients', 'Tiers'),
('clients.analytics', 'Voir analytics clients', 'Voir les statistiques clients', 'Tiers'),
('fournisseurs.read', 'Voir les fournisseurs', 'Consulter la liste des fournisseurs', 'Tiers'),
('employes.read', 'Voir les employés', 'Consulter la liste des employés', 'Tiers'),

-- Stock (locations / transferts / demandes)
('stock_locations.read', 'Voir les emplacements de stock', 'Consulter les emplacements', 'Stock'),
('stock_transfers.read', 'Voir les transferts de stock', 'Consulter les transferts', 'Stock'),
('stock_transfers.create', 'Créer un transfert de stock', 'Initier un transfert', 'Stock'),
('demandes.read', 'Voir les demandes de réapprovisionnement', 'Consulter les demandes', 'Stock'),
('demandes.create', 'Créer une demande de réapprovisionnement', 'Émettre une demande', 'Stock'),
('affectations_locations.read', 'Voir les affectations', 'Consulter les affectations d''emplacements', 'Stock'),
('stock_valuation.read', 'Voir la valorisation du stock', 'Consulter la valorisation du stock', 'Stock'),

-- Finance
('caisse.read', 'Accéder à la caisse', 'Opérer la caisse', 'Finance'),
('caisse.audit', 'Auditer la caisse', 'Consulter l''audit de caisse', 'Finance'),
('depenses.read', 'Voir les dépenses', 'Consulter les dépenses', 'Finance'),
('depenses.create', 'Créer une dépense', 'Enregistrer une nouvelle dépense', 'Finance'),
('general_ledger.read', 'Voir la comptabilité', 'Consulter le grand livre', 'Finance'),
('reporting.read', 'Voir les rapports', 'Consulter les rapports', 'Finance'),

-- Admin
('users.manage', 'Gérer les utilisateurs', 'Créer, modifier, supprimer des utilisateurs', 'Admin'),
('permissions.manage', 'Gérer les permissions', 'Modifier les permissions des utilisateurs', 'Admin')
ON CONFLICT (code) DO UPDATE SET
    nom = EXCLUDED.nom,
    description = EXCLUDED.description,
    module = EXCLUDED.module;

-- 3. Clean existing role_permissions; rebuild from App.tsx requiredRoles
TRUNCATE role_permissions;

-- Admin: every permission
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'admin'), id FROM permissions;

-- Manager: every permission EXCEPT admin module
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'manager'), id
FROM permissions
WHERE module <> 'Admin';

-- depot_staff
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'depot_staff'), id
FROM permissions
WHERE code IN (
    'dashboard.read',
    'inventaire.read',
    'fournisseurs.read',
    'commandes.read', 'commandes.create',
    'receptions.read', 'receptions.create',
    'factures_fournisseur.read', 'factures_fournisseur.create',
    'stock_locations.read',
    'stock_transfers.read', 'stock_transfers.create',
    'demandes.read', 'demandes.create'
);

-- magasin_staff
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'magasin_staff'), id
FROM permissions
WHERE code IN (
    'dashboard.read',
    'inventaire.read',
    'factures.read', 'factures.create',
    'devis.read', 'devis.create',
    'bons_livraison.read', 'bons_livraison.create',
    'demandes.read', 'demandes.create',
    'caisse.read',
    'depenses.read', 'depenses.create'
);

-- caissier
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'caissier'), id
FROM permissions
WHERE code IN (
    'dashboard.read',
    'inventaire.read',
    'factures.read', 'factures.create',
    'demandes.read', 'demandes.create',
    'caisse.read',
    'depenses.read', 'depenses.create'
);

-- viewer
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE nom = 'viewer'), id
FROM permissions
WHERE code IN (
    'dashboard.read',
    'inventaire.read'
);

COMMIT;
