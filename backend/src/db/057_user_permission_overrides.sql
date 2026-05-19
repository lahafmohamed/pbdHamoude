-- Migration: User Permission Overrides
-- Purpose: Support custom permission overrides per user

BEGIN;

-- 1. Add customiser_permissions column to utilisateurs
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS customiser_permissions BOOLEAN DEFAULT false;

-- 2. Create user_permissions table for custom overrides
CREATE TABLE IF NOT EXISTS user_permissions (
    utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (utilisateur_id, permission_id)
);

-- 3. Populate more realistic permissions from the screenshot to show off the UI beautifully
INSERT INTO permissions (code, nom, description, module) VALUES
('pesees.read', 'Accéder à la page', 'Consulter les pesées', 'Page Pesées'),
('pesees.read.prices', 'Voir les prix/montants', 'Consulter les prix des pesées', 'Page Pesées'),
('pesees.write', 'Modifier pesées', 'Créer ou éditer des pesées', 'Page Pesées'),
('pesees.delete', 'Supprimer pesée', 'Effacer définitivement des pesées', 'Page Pesées'),
('pesees.exclude', 'Ajouter à l''exclusion GESpont', 'Gérer l''exclusion GESpont', 'Page Pesées'),

('sorties.read', 'Accéder à la page', 'Consulter les sorties', 'Page Sorties'),
('sorties.read.prices', 'Voir les prix/montants', 'Consulter les prix des sorties', 'Page Sorties'),
('sorties.write.livraisons', 'Saisir code livraison + poids livré', 'Gérer les codes de livraison et poids', 'Page Sorties'),

('tickets.read', 'Accéder à la page', 'Consulter les tickets', 'Page Tickets'),
('tickets.read.prices', 'Voir les prix/montants', 'Consulter les prix des tickets', 'Page Tickets'),
('tickets.write', 'Modifier tickets', 'Éditer des tickets existants', 'Page Tickets'),
('tickets.bulk.edit', 'Édition en masse', 'Modifier plusieurs tickets simultanément', 'Page Tickets'),

('paiements.read', 'Accéder à la page', 'Consulter les paiements', 'Page Paiements'),
('paiements.read.prices', 'Voir les prix/montants', 'Consulter les montants des paiements', 'Page Paiements'),
('paiements.write', 'Créer paiement', 'Enregistrer de nouveaux paiements', 'Page Paiements')
ON CONFLICT (code) DO NOTHING;

-- 4. Enable these permissions for manager/caissier by default to make the role-defaults visual clear
DO $$ 
DECLARE
    v_manager_id INTEGER;
    v_caissier_id INTEGER;
BEGIN
    SELECT id INTO v_manager_id FROM roles WHERE nom = 'manager';
    SELECT id INTO v_caissier_id FROM roles WHERE nom = 'caissier';

    IF v_manager_id IS NOT NULL THEN
        -- Manager has most of them
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT v_manager_id, id FROM permissions WHERE code IN (
            'pesees.read', 'pesees.read.prices', 'pesees.write', 
            'sorties.read', 'sorties.read.prices', 'sorties.write.livraisons',
            'tickets.read', 'tickets.read.prices', 'tickets.write',
            'paiements.read', 'paiements.read.prices', 'paiements.write'
        ) ON CONFLICT DO NOTHING;
    END IF;

    IF v_caissier_id IS NOT NULL THEN
        -- Caissier has caisse/paiements and basic reads
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT v_caissier_id, id FROM permissions WHERE code IN (
            'pesees.read', 'sorties.read', 'tickets.read', 
            'paiements.read', 'paiements.read.prices', 'paiements.write'
        ) ON CONFLICT DO NOTHING;
    END IF;
END $$;

COMMIT;
