export interface Facture {
  id?: number;
  numero_facture: string;
  client_id: number;
  date_facture?: Date;
  sous_total: number;
  tva: number;
  total: number;
  montant_paye?: number;
  remaining_due?: number;
  statut: 'payee' | 'partielle' | 'en_attente' | 'annulee';
  notes?: string;
  created_at?: Date;
}

export interface FactureLigne {
  id?: number;
  facture_id: number;
  produit_id: number;
  quantite: number;
  prix_unitaire: number;
  total_ligne: number;
}

export interface FactureComplete extends Facture {
  client_nom?: string;
  client_prenom?: string;
  lignes?: FactureLigne[];
  paiements?: PaiementSimple[];
}

export interface PaiementSimple {
  id: number;
  montant: number;
  methode_paiement: string;
  date_paiement: Date;
  reference?: string;
}
