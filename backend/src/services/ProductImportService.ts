import pool from '../db/connection';
import { produitService } from './ProduitService';
import { logger } from '../utils/logger';

export interface ImportRow {
  reference: string;
  nom: string;
  description?: string;
  categorie?: string;
  prix_achat: number;
  prix_vente: number;
  stock?: number;
  stock_min?: number;
  code_barre?: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: { row: number; error: string }[];
}

export class ProductImportService {
  /**
   * Validate import data without saving
   */
  async validate(rows: ImportRow[]): Promise<{ valid: boolean; errors: { row: number; field: string; message: string }[] }> {
    const errors: { row: number; field: string; message: string }[] = [];

    rows.forEach((row, index) => {
      const rowNum = index + 1;

      if (!row.reference?.trim()) {
        errors.push({ row: rowNum, field: 'reference', message: 'Référence requise' });
      }

      if (!row.nom?.trim()) {
        errors.push({ row: rowNum, field: 'nom', message: 'Nom requis' });
      }

      if (row.prix_achat < 0) {
        errors.push({ row: rowNum, field: 'prix_achat', message: 'Prix d\'achat doit être positif' });
      }

      if (row.prix_vente < 0) {
        errors.push({ row: rowNum, field: 'prix_vente', message: 'Prix de vente doit être positif' });
      }

      if ((row.stock ?? 0) < 0) {
        errors.push({ row: rowNum, field: 'stock', message: 'Stock doit être positif' });
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Import products from validated data
   */
  async import(rows: ImportRow[], userId?: number): Promise<ImportResult> {
    const result: ImportResult = {
      total: rows.length,
      created: 0,
      updated: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      try {
        // Check if product exists by reference
        const existing = await pool.query(
          'SELECT id FROM produits WHERE reference = $1',
          [row.reference]
        );

        if (existing.rows.length > 0) {
          // Update existing product
          await produitService.update(existing.rows[0].id, {
            nom: row.nom,
            description: row.description,
            categorie: row.categorie,
            prix_achat: row.prix_achat,
            prix_vente: row.prix_vente,
            stock: row.stock,
            stock_min: row.stock_min,
            modifie_par: userId,
          });
          result.updated++;
        } else {
          // Create new product
          await produitService.create({
            reference: row.reference,
            nom: row.nom,
            description: row.description,
            categorie: row.categorie,
            prix_achat: row.prix_achat,
            prix_vente: row.prix_vente,
            stock: row.stock ?? 0,
            stock_min: row.stock_min ?? 5,
            cree_par: userId,
          });
          result.created++;
        }
      } catch (error: any) {
        result.errors.push({
          row: rowNum,
          error: error.message || 'Erreur inconnue',
        });
      }
    }

    logger.info({ result }, 'Product import completed');
    return result;
  }

  /**
   * Export all products to CSV
   */
  async exportToCSV(): Promise<string> {
    const { rows } = await pool.query(
      `SELECT id, reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min, code_barre
       FROM produits
       WHERE deleted_at IS NULL
       ORDER BY nom`
    );

    if (rows.length === 0) {
      return 'reference,nom,description,categorie,prix_achat,prix_vente,stock,stock_min,code_barre\n';
    }

    const headers = 'reference,nom,description,categorie,prix_achat,prix_vente,stock,stock_min,code_barre';
    const csvRows = rows.map(row => {
      return [
        this.escapeCSV(row.reference),
        this.escapeCSV(row.nom),
        this.escapeCSV(row.description || ''),
        this.escapeCSV(row.categorie || ''),
        row.prix_achat,
        row.prix_vente,
        row.stock,
        row.stock_min,
        this.escapeCSV(row.code_barre || ''),
      ].join(',');
    });

    return [headers, ...csvRows].join('\n');
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

export const productImportService = new ProductImportService();
