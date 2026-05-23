-- Migration: Consolidate all stock into the single magasin "PBD Treichville"
-- Business rule: there is no depot; all stock lives in the Treichville store.
-- Strategy: merge depot stock into Treichville, make Treichville the principal
-- location, then deactivate the depot. The depot row is kept (not deleted) so any
-- historical references remain valid; deactivating hides it from the UI.
--
-- IMPORTANT ordering: the produits.stock cache is recomputed by trigger
-- update_produits_stock_from_locations() which only sums ACTIVE locations.
-- We therefore move the stock BEFORE deactivating the depot so the cache stays
-- correct throughout.

BEGIN;

-- Resolve the two locations by code (robust against id drift).
WITH depot AS (
  SELECT id FROM stock_locations WHERE code = 'DEPOT01'
), mag AS (
  SELECT id FROM stock_locations WHERE code = 'MAG_TREICHVILLE'
)
-- 1. Merge depot stock lines into Treichville (sum on conflict).
INSERT INTO stock_par_location (produit_id, location_id, quantite, quantite_reservee)
SELECT spl.produit_id, (SELECT id FROM mag), spl.quantite, spl.quantite_reservee
FROM stock_par_location spl
WHERE spl.location_id = (SELECT id FROM depot)
ON CONFLICT (produit_id, location_id) DO UPDATE
  SET quantite          = stock_par_location.quantite + EXCLUDED.quantite,
      quantite_reservee = stock_par_location.quantite_reservee + EXCLUDED.quantite_reservee,
      updated_at        = CURRENT_TIMESTAMP;

-- 2. Remove the depot stock lines (now fully transferred).
DELETE FROM stock_par_location
WHERE location_id = (SELECT id FROM stock_locations WHERE code = 'DEPOT01');

-- 3. Make Treichville the principal location, depot no longer principal.
UPDATE stock_locations SET est_principal = false WHERE code = 'DEPOT01';
UPDATE stock_locations SET est_principal = true,  actif = true WHERE code = 'MAG_TREICHVILLE';

-- 4. Deactivate the depot so it disappears from selectors.
UPDATE stock_locations SET actif = false WHERE code = 'DEPOT01';

COMMIT;
