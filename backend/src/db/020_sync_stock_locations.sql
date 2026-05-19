-- Migration: Sync produits.stock to stock_par_location
-- This migration copies existing single-location stock to the multi-location table
-- and adds a trigger to keep produits.stock as a computed cache for backward compatibility

-- ============================================================
-- 1. SYNC EXISTING STOCK DATA TO MULTI-LOCATION TABLE
-- ============================================================

-- Copy produits.stock to stock_par_location for the MAIN location
INSERT INTO stock_par_location (produit_id, location_id, quantite, quantite_reservee)
SELECT 
  p.id,
  (SELECT id FROM stock_locations WHERE est_principal = true LIMIT 1),
  p.stock,
  0
FROM produits p
WHERE p.deleted_at IS NULL 
  AND p.stock > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_par_location spl 
    WHERE spl.produit_id = p.id 
    AND spl.location_id = (SELECT id FROM stock_locations WHERE est_principal = true LIMIT 1)
  )
ON CONFLICT (produit_id, location_id) 
DO UPDATE SET 
  quantite = EXCLUDED.quantite,
  quantite_reservee = EXCLUDED.quantite_reservee;

-- ============================================================
-- 2. CREATE TRIGGER TO MAINTAIN produits.stock AS CACHE
-- ============================================================

-- Function to update produits.stock from stock_par_location
CREATE OR REPLACE FUNCTION update_produits_stock_from_locations()
RETURNS TRIGGER AS $$
DECLARE
  total_stock INTEGER;
BEGIN
  -- Calculate total stock across all active locations
  SELECT COALESCE(SUM(quantite), 0) INTO total_stock
  FROM stock_par_location spl
  JOIN stock_locations sl ON spl.location_id = sl.id
  WHERE spl.produit_id = COALESCE(NEW.produit_id, OLD.produit_id)
    AND sl.actif = true;
  
  -- Update the cache column
  UPDATE produits 
  SET stock = total_stock
  WHERE id = COALESCE(NEW.produit_id, OLD.produit_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on stock_par_location changes
DROP TRIGGER IF EXISTS trg_sync_produits_stock ON stock_par_location;
CREATE TRIGGER trg_sync_produits_stock
  AFTER INSERT OR UPDATE OR DELETE ON stock_par_location
  FOR EACH ROW
  EXECUTE FUNCTION update_produits_stock_from_locations();

-- ============================================================
-- 3. UPDATE mouvements_stock TRIGGER TO INCLUDE LOCATION
-- ============================================================

-- Update the existing log_mouvements_stock function to accept location_id
-- This will be called by services that know the location context

-- ============================================================
-- 4. ADD HELPER FUNCTIONS FOR STOCK OPERATIONS
-- ============================================================

-- Function to get stock for a product at a specific location
CREATE OR REPLACE FUNCTION get_stock_at_location(
  p_produit_id INTEGER,
  p_location_id INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_stock INTEGER;
BEGIN
  IF p_location_id IS NULL THEN
    -- Get total across all active locations
    SELECT COALESCE(SUM(spl.quantite), 0) INTO v_stock
    FROM stock_par_location spl
    JOIN stock_locations sl ON spl.location_id = sl.id
    WHERE spl.produit_id = p_produit_id AND sl.actif = true;
  ELSE
    -- Get stock at specific location
    SELECT COALESCE(quantite, 0) INTO v_stock
    FROM stock_par_location
    WHERE produit_id = p_produit_id AND location_id = p_location_id;
  END IF;
  
  RETURN v_stock;
END;
$$ LANGUAGE plpgsql;

-- Function to adjust stock at a location
CREATE OR REPLACE FUNCTION adjust_stock_at_location(
  p_produit_id INTEGER,
  p_location_id INTEGER,
  p_quantity INTEGER,
  p_operation VARCHAR(10) -- 'add' or 'remove'
)
RETURNS VOID AS $$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
BEGIN
  -- Get current stock at location
  SELECT COALESCE(quantite, 0) INTO v_current_stock
  FROM stock_par_location
  WHERE produit_id = p_produit_id AND location_id = p_location_id;
  
  -- Calculate new stock
  IF p_operation = 'add' THEN
    v_new_stock := v_current_stock + p_quantity;
  ELSIF p_operation = 'remove' THEN
    IF v_current_stock < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock at location % for product %', p_location_id, p_produit_id;
    END IF;
    v_new_stock := v_current_stock - p_quantity;
  ELSE
    RAISE EXCEPTION 'Invalid operation: %', p_operation;
  END IF;
  
  -- Update or insert
  INSERT INTO stock_par_location (produit_id, location_id, quantite)
  VALUES (p_produit_id, p_location_id, v_new_stock)
  ON CONFLICT (produit_id, location_id) 
  DO UPDATE SET quantite = v_new_stock;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. ADD COMMENTS FOR DEPRECATION
-- ============================================================

COMMENT ON COLUMN produits.stock IS 'DEPRECATED: Cache column maintained by trigger from stock_par_location. Use stock_par_location for all stock operations.';
