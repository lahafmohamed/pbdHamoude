import { Router } from 'express';
import { FactureFournisseurController } from '../controllers/FactureFournisseurController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/', FactureFournisseurController.getAll);
router.get('/payable', FactureFournisseurController.getPayableInvoices);
router.get('/stats', FactureFournisseurController.getStats);
router.get('/:id', FactureFournisseurController.getById);
router.post('/', FactureFournisseurController.create);
router.post('/:id/paiement', FactureFournisseurController.recordPayment);

export default router;
