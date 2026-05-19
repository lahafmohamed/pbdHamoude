-- Migration: PostgreSQL Sequences for invoice/order numbering

-- Create sequences
CREATE SEQUENCE IF NOT EXISTS facture_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS commande_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS reception_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transfer_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS facture_fournisseur_numero_seq START 1;

-- Grant usage
GRANT USAGE ON SEQUENCE facture_numero_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE commande_numero_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE reception_numero_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE transfer_numero_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE facture_fournisseur_numero_seq TO CURRENT_USER;
