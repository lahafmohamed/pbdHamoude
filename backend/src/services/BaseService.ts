import pool from '../db/connection';
import { logger } from '../utils/logger';

export interface PaginationParams {
  page: number;
  limit: number;
  sort: string;
  order: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Base service with common CRUD operations
 */
export abstract class BaseService<T extends { id: number }> {
  protected abstract tableName: string;
  protected abstract selectColumns: string;
  protected defaultSortColumn: string = 'created_at';
  protected allowedSortColumns: string[] = [];

  /**
   * Find by ID
   */
  async findById(id: number): Promise<T | null> {
    const query = `SELECT ${this.selectColumns} FROM ${this.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  /**
   * Check if record exists
   */
  async exists(id: number): Promise<boolean> {
    const { rows } = await pool.query(`SELECT id FROM ${this.tableName} WHERE id = $1`, [id]);
    return rows.length > 0;
  }

  /**
   * Soft delete
   */
  async softDelete(id: number): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE ${this.tableName} SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Hard delete
   */
  async hardDelete(id: number): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Build paginated query with sorting and soft-delete filtering
   */
  protected buildPaginatedQuery(
    baseWhere: string,
    params: any[],
    pagination: PaginationParams
  ): { dataQuery: string; countQuery: string; allParams: any[] } {
    const offset = (pagination.page - 1) * pagination.limit;

    // Add soft-delete filter
    const whereClause = `${baseWhere} AND ${this.tableName}.deleted_at IS NULL`;

    // Add sorting
    const sortColumn = this.allowedSortColumns.includes(pagination.sort)
      ? pagination.sort
      : this.defaultSortColumn;
    const orderBy = ` ORDER BY ${this.tableName}.${sortColumn} ${pagination.order}`;

    // Add pagination
    const limitClause = ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const allParams = [...params, pagination.limit, offset];

    const dataQuery = `SELECT ${this.selectColumns} FROM ${this.tableName} ${whereClause}${orderBy}${limitClause}`;

    // Count query
    const countQuery = `SELECT COUNT(*) as total FROM ${this.tableName} ${whereClause}`;

    return { dataQuery, countQuery, allParams };
  }

  /**
   * Execute paginated query
   */
  protected async executePaginatedQuery(
    dataQuery: string,
    countQuery: string,
    allParams: any[],
    pagination: PaginationParams
  ): Promise<PaginatedResult<T>> {
    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, allParams),
      pool.query(countQuery, allParams.slice(0, allParams.length - 2)),
    ]);

    const total = parseInt(countResult.rows[0]?.total || '0');

    return {
      data: dataResult.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }
}
