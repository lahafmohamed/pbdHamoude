import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware factory to validate request body against a Zod schema
 */
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const zodError = error as ZodError;
        const errors = (zodError.issues || []).map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        res.status(400).json({
          success: false,
          error: 'Données invalides',
          details: errors,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Erreur de validation',
      });
      return;
    }
  };
};

/**
 * Middleware factory to validate request query against a Zod schema
 */
export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.query);
      // Merge parsed values back into query
      Object.assign(req.query, parsed);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const zodError = error as ZodError;
        const errors = (zodError.issues || []).map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        res.status(400).json({
          success: false,
          error: 'Paramètres de requête invalides',
          details: errors,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Erreur de validation',
      });
      return;
    }
  };
};

/**
 * Middleware factory to validate request params against a Zod schema
 */
export const validateParams = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.params);
      Object.assign(req.params, parsed);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const zodError = error as ZodError;
        const errors = (zodError.issues || []).map((err: any) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        res.status(400).json({
          success: false,
          error: 'Paramètres d\'URL invalides',
          details: errors,
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: 'Erreur de validation',
      });
      return;
    }
  };
};
