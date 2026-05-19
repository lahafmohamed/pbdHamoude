-- Migration pour archiver les tables 3-Way Match
-- Date: 2026-05-06
-- Raison: Suppression du module 3-Way Match jugé sur-conçu pour le contexte SMB

-- Archivage des tables 3-Way Match (renommage avec préfixe de date)
ALTER TABLE three_way_matches RENAME TO _deprecated_three_way_matches_2026_05;
ALTER TABLE three_way_match_details RENAME TO _deprecated_three_way_match_details_2026_05;

-- Création d'un commentaire pour documenter l'archivage
COMMENT ON TABLE _deprecated_three_way_matches_2026_05 IS 'Table archivée - 3-Way Match supprimé le 2026-05-06. Contient les enregistrements de matching commande/réception/facture.';
COMMENT ON TABLE _deprecated_three_way_match_details_2026_05 IS 'Table archivée - Détails 3-Way Match supprimé le 2026-05-06. Contient les écarts quantité/prix par produit.';

-- Note: Ces tables pourront être restaurées si besoin avec:
-- ALTER TABLE _deprecated_three_way_matches_2026_05 RENAME TO three_way_matches;
-- ALTER TABLE _deprecated_three_way_match_details_2026_05 RENAME TO three_way_match_details;
