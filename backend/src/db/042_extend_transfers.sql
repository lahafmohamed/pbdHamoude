-- Migration: Extend Stock Transfers for Unified Workflow
-- Purpose: Link transfers to demandes + add new status values

-- ============================================
-- 1. EXTEND stock_transfers TABLE
-- ============================================

-- Add demande_id (nullable = proactive transfer without prior demand)
ALTER TABLE stock_transfers 
    ADD COLUMN IF NOT EXISTS demande_id INTEGER REFERENCES demandes_reapprovisionnement(id) ON DELETE SET NULL;

-- Add index for demande lookups
CREATE INDEX IF NOT EXISTS idx_stock_transfers_demande ON stock_transfers(demande_id);

-- Add comment
COMMENT ON COLUMN stock_transfers.demande_id IS 'Links to demande that initiated this transfer (NULL = proactive depot transfer)';

-- ============================================
-- 2. EXTEND stock_transfer_lignes
-- ============================================

-- Add demande_ligne_id to link back to specific demande line
ALTER TABLE stock_transfer_lignes
    ADD COLUMN IF NOT EXISTS demande_ligne_id INTEGER REFERENCES demandes_reapprovisionnement_lignes(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lignes_demande_ligne ON stock_transfer_lignes(demande_ligne_id);

COMMENT ON COLUMN stock_transfer_lignes.demande_ligne_id IS 'Links to specific demande line (for partial fulfillment tracking)';

-- ============================================
-- 3. UPDATE stock_transfers STATUT VALUES
-- ============================================

-- The existing constraint allows: 'en_attente', 'en_transit', 'completee', 'annulee'
-- We need to expand this to match the new workflow

-- Create new status type
CREATE TYPE transfer_statut_new AS ENUM (
    'en_preparation',   -- Transfer created, stock reserved but not moved
    'en_cours',         -- Being executed
    'livre',            -- Stock moved (completed)
    'annule'            -- Cancelled
);

-- Migrate existing data
-- en_attente -> en_preparation
-- en_transit -> en_cours
-- completee -> livre
-- annulee -> annule

ALTER TABLE stock_transfers 
    ALTER COLUMN statut TYPE VARCHAR(20); -- Temporarily remove constraint

UPDATE stock_transfers 
    SET statut = CASE statut
        WHEN 'en_attente' THEN 'en_preparation'
        WHEN 'en_transit' THEN 'en_cours'
        WHEN 'completee' THEN 'livre'
        WHEN 'annulee' THEN 'annule'
        ELSE 'en_preparation'
    END;

-- Apply new constraint
ALTER TABLE stock_transfers 
    ALTER COLUMN statut TYPE transfer_statut_new 
    USING statut::transfer_statut_new;

-- ============================================
-- 4. TRIGGER TO SYNC DEMANDE STATUS ON TRANSFER
-- ============================================

CREATE OR REPLACE FUNCTION sync_demande_on_transfer_change()
RETURNS TRIGGER AS $$
BEGIN
    -- When transfer becomes 'livre', update demande to 'livree'
    IF NEW.statut = 'livre' AND OLD.statut != 'livre' AND NEW.demande_id IS NOT NULL THEN
        UPDATE demandes_reapprovisionnement
        SET statut = 'livree',
            date_livraison = CURRENT_TIMESTAMP
        WHERE id = NEW.demande_id
          AND statut = 'en_cours';
    END IF;
    
    -- When transfer is created with demande_id, set demande to 'en_cours'
    IF NEW.demande_id IS NOT NULL AND TG_OP = 'INSERT' THEN
        UPDATE demandes_reapprovisionnement
        SET statut = 'en_cours',
            transfert_id = NEW.id,
            date_execution = CURRENT_TIMESTAMP
        WHERE id = NEW.demande_id
          AND statut IN ('approuvee', 'partiellement_approuvee');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_demande_transfer ON stock_transfers;
CREATE TRIGGER trg_sync_demande_transfer
    AFTER INSERT OR UPDATE ON stock_transfers
    FOR EACH ROW
    EXECUTE FUNCTION sync_demande_on_transfer_change();

COMMENT ON FUNCTION sync_demande_on_transfer_change IS 'Automatically syncs demande status when linked transfer changes';

-- ============================================
-- 5. VIEW FOR TRANSFER DETAILS WITH DEMANDE INFO
-- ============================================

CREATE OR REPLACE VIEW v_stock_transfers AS
SELECT 
    st.*,
    ls.code AS source_code,
    ls.nom AS source_nom,
    ls.location_type AS source_type,
    ld.code AS destination_code,
    ld.nom AS destination_nom,
    ld.location_type AS destination_type,
    d.numero AS demande_numero,
    d.statut AS demande_statut,
    d.magasin_id AS demande_magasin_id,
    d.depot_id AS demande_depot_id,
    u.username AS cree_par_username,
    u.nom_complet AS cree_par_nom
FROM stock_transfers st
JOIN stock_locations ls ON st.location_source_id = ls.id
JOIN stock_locations ld ON st.location_destination_id = ld.id
LEFT JOIN demandes_reapprovisionnement d ON st.demande_id = d.id
LEFT JOIN utilisateurs u ON st.cree_par = u.id;

COMMENT ON VIEW v_stock_transfers IS 'Convenience view for transfer details including demande linkage';

-- ============================================
-- 6. FUNCTION TO CHECK STOCK AVAILABILITY AT SOURCE
-- ============================================

CREATE OR REPLACE FUNCTION check_stock_disponible(
    p_produit_id INTEGER,
    p_location_id INTEGER,
    p_quantite_demandee INTEGER
)
RETURNS TABLE (
    disponible BOOLEAN,
    quantite_stock INTEGER,
    message TEXT
) AS $$
DECLARE
    v_stock INTEGER;
BEGIN
    SELECT COALESCE(spl.quantite, 0) 
    INTO v_stock
    FROM stock_par_location spl
    WHERE spl.produit_id = p_produit_id 
      AND spl.location_id = p_location_id;
    
    RETURN QUERY SELECT 
        v_stock >= p_quantite_demandee,
        v_stock,
        CASE 
            WHEN v_stock >= p_quantite_demandee THEN 'Stock suffisant'
            ELSE 'Stock insuffisant: ' || v_stock || ' disponible, ' || p_quantite_demandee || ' demandé'
        END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_stock_disponible IS 'Checks if requested quantity is available at location';
