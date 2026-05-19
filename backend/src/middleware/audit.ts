import { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Audit action types
 */
export type AuditAction = string;

/**
 * Middleware factory to create audit log entries
 * Attaches an audit callback to the response for controllers to call after successful operations
 */
export const audit = (tableName: string, action: AuditAction, getIdFn?: (req: Request) => number | undefined) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Only audit successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const authReq = req as AuthRequest;
        const userId = authReq.user?.id;
        const recordId = getIdFn ? getIdFn(req) : (req.params.id ? parseInt(req.params.id) : undefined);

        if (recordId) {
          // Fire-and-forget audit logging (don't block the response)
          pool.query(
            `INSERT INTO audit_log (utilisateur_id, action, table_name, record_id, ip_address, user_agent, new_values)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              userId || null,
              action,
              tableName,
              recordId,
              req.ip,
              req.get('user-agent'),
              req.body ? JSON.stringify(req.body) : null,
            ]
          ).catch((err) => {
            logger.error({ err }, 'Audit logging failed');
          });
        }
      }

      return originalJson(body);
    };

    next();
  };
};

/**
 * Manual audit function for use in controllers (e.g., during transactions)
 */
export const logAudit = async (params: {
  utilisateur_id?: number | null;
  action: AuditAction;
  table_name: string;
  record_id: number;
  req?: Request;
  old_values?: any;
  new_values?: any;
}): Promise<void> => {
  try {
    await pool.query(
      `INSERT INTO audit_log (utilisateur_id, action, table_name, record_id, ip_address, user_agent, old_values, new_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.utilisateur_id ?? null,
        params.action,
        params.table_name,
        params.record_id,
        params.req?.ip || null,
        params.req?.get('user-agent') || null,
        params.old_values ? JSON.stringify(params.old_values) : null,
        params.new_values ? JSON.stringify(params.new_values) : null,
      ]
    );
  } catch (error) {
    logger.error({ error }, 'Manual audit logging failed');
  }
};
