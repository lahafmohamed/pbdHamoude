-- Migration: Cash Register Sessions (Caisse)
-- Track daily cash register sessions with opening/closing balances

-- Cash register sessions table
CREATE TABLE IF NOT EXISTS sessions_caisse (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  date_ouverture TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_fermeture TIMESTAMP,
  solde_ouverture NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  solde_fermeture NUMERIC(15, 2),
  solde_theorique NUMERIC(15, 2),
  ecart NUMERIC(15, 2),
  notes_ouverture TEXT,
  notes_fermeture TEXT,
  statut VARCHAR(20) DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'fermee')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cash movements within a session
CREATE TABLE IF NOT EXISTS mouvements_caisse (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions_caisse(id) ON DELETE CASCADE,
  facture_id INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  montant NUMERIC(15, 2) NOT NULL,
  type_mouvement VARCHAR(50) NOT NULL CHECK (type_mouvement IN ('vente', 'remise', 'sortie', 'entree_autre')),
  methode_paiement VARCHAR(50) CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  description TEXT,
  date_mouvement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_utilisateur ON sessions_caisse(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_statut ON sessions_caisse(statut);
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_date ON sessions_caisse(date_ouverture);
CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_session ON mouvements_caisse(session_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_facture ON mouvements_caisse(facture_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_date ON mouvements_caisse(date_mouvement);

-- Comments
COMMENT ON TABLE sessions_caisse IS 'Sessions de caisse quotidiennes';
COMMENT ON TABLE mouvements_caisse IS 'Mouvements de trésorerie par session';
