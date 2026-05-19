-- Migration: Demandes de Réapprovisionnement (Enhanced Stock Request Workflow)
-- Purpose: Replace internal_stock_requests with full state machine and strict role workflow

-- ============================================
-- 1. SEQUENCES FOR NUMBERING
-- ============================================

CREATE SEQUENCE IF NOT EXISTS demande_reappro_numero_seq START 1;
GRANT USAGE ON SEQUENCE demande_reappro_numero_seq TO CURRENT_USER;

-- ============================================
-- 2. MAIN DEMANDE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS demandes_reapprovisionnement (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) UNIQUE NOT NULL, -- Format: DEM-YYYY-NNNN
    
    -- Locations
    magasin_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    depot_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    
    -- State machine
    statut VARCHAR(30) NOT NULL DEFAULT 'brouillon'
        CHECK (statut IN (
            'brouillon',           -- Composing, not visible to depot
            'envoyee',             -- Submitted, visible to depot
            'approuvee',           -- Full approval
            'partiellement_approuvee', -- Partial approval
            'refusee',             -- Rejected
            'en_cours',            -- Transfer initiated
            'livree',              -- Stock physically moved
            'cloturee'             -- Magasin confirmed receipt
        )),
    
    -- Users
    created_by_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
    decided_by_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL, -- Approver/Rejecter
    executed_by_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL, -- Transfer executor
    closed_by_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL, -- Magasin closer
    
    -- Dates
    date_creation TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_envoi TIMESTAMP,
    date_decision TIMESTAMP,
    date_execution TIMESTAMP,
    date_livraison TIMESTAMP,
    date_cloture TIMESTAMP,
    
    -- Notes
    motif TEXT, -- Magasin-side note
    raison_refus TEXT, -- Depot-side note when refused
    
    -- Linked transfer (null = demande was never fulfilled)
    transfert_id INTEGER REFERENCES stock_transfers(id) ON DELETE SET NULL,
    
    -- Timestamps
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: magasin and depot must be different
    CHECK (magasin_id <> depot_id)
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_demandes_reapprovisionnement_updated_at ON demandes_reapprovisionnement;
CREATE TRIGGER update_demandes_reapprovisionnement_updated_at 
    BEFORE UPDATE ON demandes_reapprovisionnement
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes_reapprovisionnement(statut);
CREATE INDEX IF NOT EXISTS idx_demandes_magasin ON demandes_reapprovisionnement(magasin_id);
CREATE INDEX IF NOT EXISTS idx_demandes_depot ON demandes_reapprovisionnement(depot_id);
CREATE INDEX IF NOT EXISTS idx_demandes_created_by ON demandes_reapprovisionnement(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_demandes_date_creation ON demandes_reapprovisionnement(date_creation DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_transfert ON demandes_reapprovisionnement(transfert_id);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_demandes_depot_statut ON demandes_reapprovisionnement(depot_id, statut);
CREATE INDEX IF NOT EXISTS idx_demandes_magasin_statut ON demandes_reapprovisionnement(magasin_id, statut);

COMMENT ON TABLE demandes_reapprovisionnement IS 'Stock replenishment requests from magasin to depot with full state machine';
COMMENT ON COLUMN demandes_reapprovisionnement.statut IS 'State machine: brouillon→envoyee→[approuvee|partiellement_approuvee|refusee]→en_cours→livree→cloturee';

-- ============================================
-- 3. DEMANDE LINES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS demandes_reapprovisionnement_lignes (
    id SERIAL PRIMARY KEY,
    demande_id INTEGER NOT NULL REFERENCES demandes_reapprovisionnement(id) ON DELETE CASCADE,
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
    
    -- Quantities
    quantite_demandee INTEGER NOT NULL CHECK (quantite_demandee > 0),
    quantite_approuvee INTEGER, -- NULL until approved; can be 0 (refused line)
    quantite_livree INTEGER, -- NULL until delivered; actual qty transferred
    
    -- Line-level notes
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(demande_id, produit_id)
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_demandes_lignes_updated_at ON demandes_reapprovisionnement_lignes;
CREATE TRIGGER update_demandes_lignes_updated_at 
    BEFORE UPDATE ON demandes_reapprovisionnement_lignes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_demandes_lignes_demande ON demandes_reapprovisionnement_lignes(demande_id);
CREATE INDEX IF NOT EXISTS idx_demandes_lignes_produit ON demandes_reapprovisionnement_lignes(produit_id);

COMMENT ON TABLE demandes_reapprovisionnement_lignes IS 'Line items for replenishment requests with requested/approved/delivered quantities';

-- ============================================
-- 4. AUDIT HISTORY TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS demandes_reapprovisionnement_history (
    id SERIAL PRIMARY KEY,
    demande_id INTEGER NOT NULL REFERENCES demandes_reapprovisionnement(id) ON DELETE CASCADE,
    
    -- State transition
    from_statut VARCHAR(30),
    to_statut VARCHAR(30) NOT NULL,
    
    -- Who did it
    user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
    
    -- When
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- What changed (JSON payload)
    payload JSONB,
    
    -- IP and user agent for audit
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_demandes_history_demande ON demandes_reapprovisionnement_history(demande_id);
CREATE INDEX IF NOT EXISTS idx_demandes_history_timestamp ON demandes_reapprovisionnement_history(timestamp DESC);

COMMENT ON TABLE demandes_reapprovisionnement_history IS 'Append-only audit log of all state transitions on demandes';

-- ============================================
-- 5. TRIGGER FUNCTION FOR AUDIT LOG
-- ============================================

CREATE OR REPLACE FUNCTION log_demande_state_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if status actually changed
    IF OLD.statut IS DISTINCT FROM NEW.statut THEN
        INSERT INTO demandes_reapprovisionnement_history (
            demande_id,
            from_statut,
            to_statut,
            user_id,
            payload
        ) VALUES (
            NEW.id,
            OLD.statut,
            NEW.statut,
            COALESCE(NEW.decided_by_user_id, NEW.executed_by_user_id, NEW.closed_by_user_id),
            jsonb_build_object(
                'decided_by_user_id', NEW.decided_by_user_id,
                'executed_by_user_id', NEW.executed_by_user_id,
                'closed_by_user_id', NEW.closed_by_user_id,
                'raison_refus', NEW.raison_refus,
                'transfert_id', NEW.transfert_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_demande_state_change ON demandes_reapprovisionnement;
CREATE TRIGGER trg_demande_state_change
    AFTER UPDATE ON demandes_reapprovisionnement
    FOR EACH ROW
    EXECUTE FUNCTION log_demande_state_change();

-- ============================================
-- 6. HELPER FUNCTION TO GENERATE DEMANDE NUMBER
-- ============================================

CREATE OR REPLACE FUNCTION generate_demande_numero()
RETURNS VARCHAR(50) AS $$
DECLARE
    v_year INTEGER;
    v_seq INTEGER;
    v_numero VARCHAR(50);
BEGIN
    v_year := EXTRACT(YEAR FROM CURRENT_DATE);
    SELECT nextval('demande_reappro_numero_seq') INTO v_seq;
    v_numero := 'DEM-' || v_year || '-' || LPAD(v_seq::TEXT, 5, '0');
    RETURN v_numero;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_demande_numero IS 'Generates atomic demande numbers (DEM-YYYY-NNNNN)';

-- ============================================
-- 7. VIEW FOR DEMANDE DETAILS (convenience)
-- ============================================

CREATE OR REPLACE VIEW v_demandes_reapprovisionnement AS
SELECT 
    d.*,
    m.code AS magasin_code,
    m.nom AS magasin_nom,
    dp.code AS depot_code,
    dp.nom AS depot_nom,
    u1.username AS created_by_username,
    u1.nom_complet AS created_by_nom,
    u2.username AS decided_by_username,
    u2.nom_complet AS decided_by_nom,
    u3.username AS executed_by_username,
    u3.nom_complet AS executed_by_nom,
    u4.username AS closed_by_username,
    u4.nom_complet AS closed_by_nom,
    st.numero_transfer
FROM demandes_reapprovisionnement d
JOIN stock_locations m ON d.magasin_id = m.id
JOIN stock_locations dp ON d.depot_id = dp.id
LEFT JOIN utilisateurs u1 ON d.created_by_user_id = u1.id
LEFT JOIN utilisateurs u2 ON d.decided_by_user_id = u2.id
LEFT JOIN utilisateurs u3 ON d.executed_by_user_id = u3.id
LEFT JOIN utilisateurs u4 ON d.closed_by_user_id = u4.id
LEFT JOIN stock_transfers st ON d.transfert_id = st.id;

COMMENT ON VIEW v_demandes_reapprovisionnement IS 'Convenience view for demande details with related data';

-- ============================================
-- 8. MIGRATE DATA FROM OLD TABLE (if exists)
-- ============================================

DO $$
BEGIN
    -- Only migrate if old table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'internal_stock_requests') THEN
        
        -- Migrate headers
        INSERT INTO demandes_reapprovisionnement (
            id, -- Preserve ID for line migration
            numero,
            magasin_id,
            depot_id,
            statut,
            created_by_user_id,
            decided_by_user_id,
            executed_by_user_id,
            date_creation,
            date_envoi,
            date_decision,
            date_execution,
            motif,
            raison_refus,
            transfert_id
        )
        SELECT 
            isr.id,
            CASE 
                WHEN isr.numero_demande IS NOT NULL THEN isr.numero_demande
                ELSE 'DEM-MIGRATED-' || isr.id
            END,
            isr.magasin_id,
            isr.depot_id,
            CASE isr.statut
                WHEN 'en_attente' THEN 'envoyee'
                WHEN 'validee' THEN 'approuvee'
                WHEN 'refusee' THEN 'refusee'
                WHEN 'executee' THEN 'livree'
                WHEN 'annulee' THEN 'refusee' -- Map cancelled to refused
                ELSE 'brouillon'
            END,
            isr.cree_par,
            isr.valide_par,
            isr.execute_par,
            COALESCE(isr.created_at, CURRENT_TIMESTAMP),
            CASE WHEN isr.statut != 'brouillon' THEN isr.created_at END,
            isr.date_validation,
            isr.date_execution,
            isr.notes,
            isr.motif_refus,
            isr.transfer_id
        FROM internal_stock_requests isr
        ON CONFLICT (id) DO NOTHING;
        
        -- Migrate lines (only if we migrated any headers)
        IF EXISTS (SELECT 1 FROM demandes_reapprovisionnement LIMIT 1) THEN
            INSERT INTO demandes_reapprovisionnement_lignes (
                demande_id,
                produit_id,
                quantite_demandee,
                quantite_approuvee,
                quantite_livree
            )
            SELECT 
                isl.request_id,
                isl.produit_id,
                isl.quantite_demandee,
                isl.quantite_validee,
                isl.quantite_transferee
            FROM internal_stock_request_lignes isl
            WHERE EXISTS (
                SELECT 1 FROM demandes_reapprovisionnement d WHERE d.id = isl.request_id
            )
            ON CONFLICT (demande_id, produit_id) DO NOTHING;
        END IF;
        
        -- Sync sequence to max ID
        PERFORM setval('demande_reappro_numero_seq', COALESCE((SELECT MAX(id) FROM demandes_reapprovisionnement), 1));
        
    END IF;
END $$;
