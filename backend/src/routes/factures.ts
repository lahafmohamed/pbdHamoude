import { Router } from 'express';
import { FactureController } from '../controllers/FactureController';
import { PaiementController } from '../controllers/PaiementController';
import { validateBody } from '../middleware/validation';
import { createFactureSchema, updateFactureStatutSchema, createPaiementSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', FactureController.getAll);
router.get('/stats', FactureController.getStats);
router.get('/revenue-trends', FactureController.getRevenueTrends);
router.get('/top-products', FactureController.getTopProducts);
router.get('/top-clients', FactureController.getTopClients);
router.get('/:id', FactureController.getById);
router.get('/:id/pdf', FactureController.generatePDF);
router.post('/', validateBody(createFactureSchema), FactureController.create);
router.put('/:id/statut', authorize('admin', 'manager'), validateBody(updateFactureStatutSchema), FactureController.updateStatut);
router.delete('/:id', authorize('admin', 'manager'), FactureController.delete);

// Payment routes for invoices
router.get('/:factureId/paiements', PaiementController.getByFacture);
router.post('/:factureId/paiements', validateBody(createPaiementSchema), PaiementController.create);

export default router;
