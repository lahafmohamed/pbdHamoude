import { Router } from 'express';
import { POSController } from '../controllers/POSController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All POS routes require authentication
router.use(authenticate);

// Session management
router.post('/open', POSController.openSession);
router.get('/session', POSController.getCurrentSession);
router.post('/:sessionId/close', POSController.closeSession);
router.get('/:sessionId/summary', POSController.getSessionSummary);

// Barcode scanning
router.get('/scan', POSController.scanBarcode);

// Quick sale
router.post('/sale', POSController.processQuickSale);

export default router;
