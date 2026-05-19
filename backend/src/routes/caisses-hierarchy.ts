import { Router } from 'express';
import { CaisseHierarchyController } from '../controllers/CaisseHierarchyController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/caisses-hierarchy - Get all caisses
router.get('/', CaisseHierarchyController.getAll);

// GET /api/caisses-hierarchy/:id - Get caisse by ID
router.get('/:id', CaisseHierarchyController.getById);

// GET /api/caisses-hierarchy/principale - Get main caisse
router.get('/principale/details', CaisseHierarchyController.getPrincipale);

// GET /api/caisses-hierarchy/magasins - Get magasin caisses
router.get('/magasins/list', CaisseHierarchyController.getMagasinCaisses);

// POST /api/caisses-hierarchy - Create caisse (admin only)
router.post('/', authorize(['admin']), CaisseHierarchyController.create);

// PUT /api/caisses-hierarchy/:id - Update caisse (admin only)
router.put('/:id', authorize(['admin']), CaisseHierarchyController.update);

// PATCH /api/caisses-hierarchy/:id/deactivate - Deactivate caisse (admin only)
router.patch('/:id/deactivate', authorize(['admin']), CaisseHierarchyController.deactivate);

// POST /api/caisses-hierarchy/transferts - Transfer funds between caisses
router.post('/transferts', authorize(['admin', 'manager']), CaisseHierarchyController.transfererFonds);

// GET /api/caisses-hierarchy/transferts/history - Get transfer history
router.get('/transferts/history', CaisseHierarchyController.getTransferts);

// GET /api/caisses-hierarchy/consolidated-report - Get consolidated cash report
router.get('/consolidated-report', authorize(['admin', 'manager']), CaisseHierarchyController.getConsolidatedReport);

// GET /api/caisses-hierarchy/:id/balance - Get caisse balance with recent transfers
router.get('/:id/balance', CaisseHierarchyController.getBalance);

export default router;
