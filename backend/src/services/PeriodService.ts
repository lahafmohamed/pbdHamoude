import pool from '../db/connection';

/**
 * Throws if the accounting period for the given date is closed.
 * Pass the transaction client to run inside an existing transaction.
 */
export async function checkPeriodIsOpen(date: Date, dbClient?: any): Promise<void> {
  const q = dbClient || pool;
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12

  const { rows } = await q.query(
    `SELECT statut FROM periodes_comptables WHERE exercice = $1 AND periode = $2`,
    [year, month]
  );

  if (rows.length > 0 && rows[0].statut === 'fermee') {
    const err: any = new Error(
      `Période comptable ${String(month).padStart(2, '0')}/${year} est clôturée. Aucune écriture n'est autorisée.`
    );
    err.statusCode = 422;
    err.code = 'PERIOD_CLOSED';
    throw err;
  }
}
