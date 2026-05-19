import { Router } from 'express';
import { EmployeController } from '../controllers/EmployeController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/', EmployeController.getAll);
router.get('/stats', EmployeController.getStats);
router.get('/:id', EmployeController.getById);
router.post('/', EmployeController.create);
router.post('/:id/commission', EmployeController.recordCommission);
router.get('/:id/commissions', EmployeController.getCommissions);
router.get('/:id/commission-summary', EmployeController.getCommissionSummary);
router.post('/shifts', EmployeController.recordShift);

export default router;
