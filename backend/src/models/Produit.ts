export interface Produit {
  id?: number;
  reference: string;
  nom: string;
  description?: string;
  categorie?: string;
  prix_achat: number;
  prix_vente: number;
  stock: number;
  stock_min: number;
  created_at?: Date;
  updated_at?: Date;
}
