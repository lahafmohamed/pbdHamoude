-- Migration 054: Allow 'compensation' as a valid methode_paiement for acomptes
-- This enables the CompensationService to create acomptes_clients entries
-- that feed into the FIFO allocation engine, updating facture statuses.

ALTER TABLE acomptes_clients
  DROP CONSTRAINT IF EXISTS acomptes_clients_methode_paiement_check;

ALTER TABLE acomptes_clients
  ADD CONSTRAINT acomptes_clients_methode_paiement_check
  CHECK (methode_paiement IN (
    'espece','carte','cheque','virement',
    'mobile_money','orange_money','mtn_money','wave',
    'compensation'
  ));

ALTER TABLE acomptes_fournisseur
  DROP CONSTRAINT IF EXISTS acomptes_fournisseur_methode_paiement_check;

ALTER TABLE acomptes_fournisseur
  ADD CONSTRAINT acomptes_fournisseur_methode_paiement_check
  CHECK (methode_paiement IN (
    'espece','carte','cheque','virement',
    'mobile_money','orange_money','mtn_money','wave',
    'compensation'
  ));
