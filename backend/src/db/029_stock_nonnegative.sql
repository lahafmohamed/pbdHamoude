-- Migration 029: Enforce non-negative stock on produits
-- Prevents stock from going below 0 through any direct update.

-- Fix any existing negative values first (shouldn't exist, but safety first)
UPDATE produits SET stock = 0 WHERE stock < 0;

ALTER TABLE produits
  ADD CONSTRAINT produits_stock_nonnegative CHECK (stock >= 0);
