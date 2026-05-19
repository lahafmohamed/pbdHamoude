-- Migration: Ajouter la recherche floue (fuzzy search) avec pg_trgm
-- Cette migration active l'extension pg_trgm pour la recherche approximative

-- Activer l'extension pg_trgm si elle n'est pas déjà activée
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Créer un index GIN sur le nom du produit pour la recherche floue rapide
CREATE INDEX IF NOT EXISTS idx_produits_nom_trgm ON produits USING gin (nom gin_trgm_ops);

-- Créer un index GIN sur la référence du produit
CREATE INDEX IF NOT EXISTS idx_produits_reference_trgm ON produits USING gin (reference gin_trgm_ops);

-- Créer un index GIN sur la description du produit
CREATE INDEX IF NOT EXISTS idx_produits_description_trgm ON produits USING gin (COALESCE(description, '') gin_trgm_ops);

-- Créer un index GIN sur la catégorie du produit
CREATE INDEX IF NOT EXISTS idx_produits_categorie_trgm ON produits USING gin (COALESCE(categorie, '') gin_trgm_ops);

-- Créer une vue matérialisée pour la recherche rapide (optionnel, à rafraîchir périodiquement)
-- DROP MATERIALIZED VIEW IF EXISTS produits_search_view;
-- CREATE MATERIALIZED VIEW produits_search_view AS
-- SELECT 
--     id,
--     reference,
--     nom,
--     description,
--     categorie,
--     setweight(to_tsvector('french', COALESCE(nom, '')), 'A') ||
--     setweight(to_tsvector('french', COALESCE(reference, '')), 'B') ||
--     setweight(to_tsvector('french', COALESCE(description, '')), 'C') ||
--     setweight(to_tsvector('french', COALESCE(categorie, '')), 'D') as document
-- FROM produits
-- WHERE deleted_at IS NULL;

-- CREATE INDEX idx_produits_search ON produits_search_view USING gin(document);
