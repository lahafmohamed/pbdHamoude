import { z } from 'zod';

// Reception schemas
export const receptionLigneSchema = z.object({
  produit_id: z.coerce.number().int().positive('Produit requis'),
  quantite_commandee: z.coerce.number().int().positive('Quantité commandée requise'),
  quantite_recue: z.coerce.number().int().nonnegative('Quantité reçue requise'),
  cout_unitaire: z.coerce.number().nonnegative('Coût unitaire requis'),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const createReceptionSchema = z.object({
  commande_id: z.coerce.number().int().positive('Commande requise'),
  location_id: z.coerce.number().int().positive('Location requise').optional(),
  notes: z.string().max(2000).optional().or(z.literal('')),
  lignes: z.array(receptionLigneSchema).min(1, 'Au moins une ligne requise'),
});

// Returns schemas
export const returnLigneSchema = z.object({
  facture_id: z.coerce.number().int().positive('Facture requise'),
  produit_id: z.coerce.number().int().positive('Produit requis'),
  quantite: z.coerce.number().int().positive('Quantité requise'),
  raison: z.string().min(1, 'Raison requise').max(500),
});

export const createReturnSchema = z.object({
  client_id: z.coerce.number().int().positive('Client requis'),
  lignes: z.array(returnLigneSchema).min(1, 'Au moins une ligne requise'),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

// Reporting schemas
export const reportDateRangeSchema = z.object({
  date_debut: z.string().datetime().or(z.string().date()),
  date_fin: z.string().datetime().or(z.string().date()),
});

export const productImportSchema = z.object({
  reference: z.string().min(1).max(50),
  nom: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  categorie: z.string().max(100).optional(),
  prix_achat: z.coerce.number().nonnegative(),
  prix_vente: z.coerce.number().nonnegative(),
  stock: z.coerce.number().int().nonnegative().default(0),
  stock_min: z.coerce.number().int().nonnegative().default(5),
  code_barre: z.string().max(50).optional().or(z.literal('')),
});
