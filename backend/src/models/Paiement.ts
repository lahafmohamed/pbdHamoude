export interface Paiement {
  id?: number;
  facture_id: number;
  montant: number;
  methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement';
  date_paiement?: Date;
  reference?: string;
  notes?: string;
  cree_par?: number;
  created_at?: Date;
}

export interface PaiementWithFacture extends Paiement {
  numero_facture?: string;
  client_nom?: string;
  client_prenom?: string;
}
