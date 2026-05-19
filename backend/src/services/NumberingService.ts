import pool from '../db/connection';

export type DocumentType = 'facture' | 'devis' | 'bl' | 'avoir';

const sequenceNames: Record<DocumentType, string> = {
  facture: 'facture_numero_seq',
  devis: 'devis_seq',
  bl: 'bl_seq',
  avoir: 'avoir_seq',
};

const prefixes: Record<DocumentType, string> = {
  facture: 'FAC',
  devis: 'DEV',
  bl: 'BL',
  avoir: 'AVOIR',
};

/**
 * Generate a document number using the PostgreSQL sequence.
 * Format: PREFIX-YYYY-#####
 */
export async function generateDocumentNumber(
  type: DocumentType,
  client?: any
): Promise<string> {
  const pgClient = client || pool;
  const seqName = sequenceNames[type];
  const prefix = prefixes[type];
  const year = new Date().getFullYear();

  const { rows } = await pgClient.query(`SELECT nextval('${seqName}') as num`);
  const seq = String(rows[0].num).padStart(5, '0');

  return `${prefix}-${year}-${seq}`;
}
