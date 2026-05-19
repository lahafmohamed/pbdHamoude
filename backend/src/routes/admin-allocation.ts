import { Router } from 'express';
import { AdminAllocationController } from '../controllers/AdminAllocationController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All admin allocation endpoints require authentication
router.use(authenticate);

// POST /api/admin/allocation/recompute-all - Recompute all client allocations (admin only)
router.post('/recompute-all', authorize(['admin']), AdminAllocationController.recomputeAll);

// GET /api/admin/allocation/test/:clientId - Test allocation for specific client (admin/manager)
router.get('/test/:clientId', authorize(['admin', 'manager']), AdminAllocationController.testClient);

// POST /api/admin/allocation/recompute/:clientId - Recompute allocation for specific client (admin/manager)
router.post('/recompute/:clientId', authorize(['admin', 'manager']), AdminAllocationController.recomputeClient);

export default router;
