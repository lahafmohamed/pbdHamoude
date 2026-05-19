/**
 * Safe pagination parser.
 * Clamps page >= 1, limit between 1 and 100, and validates sort order.
 */
export function parsePagination(
  query: Record<string, any>,
  defaults: { page?: number; limit?: number; sort?: string; order?: 'ASC' | 'DESC' } = {}
): { page: number; limit: number; sort: string; order: 'ASC' | 'DESC' } {
  const page = Math.max(1, parseInt(query.page as string) || defaults.page || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || defaults.limit || 20));
  const sort = (query.sort as string) || defaults.sort || 'created_at';
  const rawOrder = ((query.order as string) || defaults.order || 'asc').toUpperCase();
  const order: 'ASC' | 'DESC' = rawOrder === 'DESC' ? 'DESC' : 'ASC';
  return { page, limit, sort, order };
}
