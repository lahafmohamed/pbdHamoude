import { Request, Response } from 'express';
import { ClientAllocationService } from '../services/ClientAllocationService';
import { logger } from '../utils/logger';

export class AdminAllocationController {

  /**
   * Recompute FIFO allocations for all clients (admin endpoint)
   */
  static async recomputeAll(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Starting full FIFO allocation recompute (admin endpoint)');

      const result = await ClientAllocationService.recomputeAllAllocations();

      logger.info('Full FIFO allocation recompute completed', { 
        clientsProcessed: result.clientsProcessed,
        facturesUpdated: result.facturesUpdated,
        msElapsed: result.msElapsed
      } as any);

      res.json({
        success: true,
        message: 'Allocation FIFO recalculée pour tous les clients',
        data: {
          clients_processed: result.clientsProcessed,
          factures_updated: result.facturesUpdated,
          ms_elapsed: result.msElapsed,
          summary: result.summary.slice(0, 10) // First 10 clients as sample
        }
      });

    } catch (error) {
      logger.error({ err: error }, 'Error in admin recompute all allocations');
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors du recalcul des allocations FIFO' 
      });
    }
  }

  /**
   * Test FIFO allocation for a specific client (dry run)
   */
  static async testClient(req: Request, res: Response): Promise<void> {
    try {
      const clientId = parseInt(req.params.clientId);
      
      if (isNaN(clientId)) {
        res.status(400).json({ error: 'ID client invalide' });
        return;
      }

      const result = await ClientAllocationService.testAllocation(clientId);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error({ err: error }, 'Error testing client allocation');
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors du test d\'allocation' 
      });
    }
  }

  /**
   * Recompute FIFO allocation for a specific client (live)
   */
  static async recomputeClient(req: Request, res: Response): Promise<void> {
    try {
      const clientId = parseInt(req.params.clientId);
      
      if (isNaN(clientId)) {
        res.status(400).json({ error: 'ID client invalide' });
        return;
      }

      const result = await ClientAllocationService.recomputeClientAllocations(clientId);

      res.json({
        success: true,
        message: `Allocation FIFO recalculée pour le client ${clientId}`,
        data: result
      });

    } catch (error) {
      logger.error({ err: error }, 'Error recomputing client allocation');
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors du recalcul d\'allocation FIFO' 
      });
    }
  }
}
