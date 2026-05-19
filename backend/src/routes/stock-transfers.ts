import { Router } from 'express';
import { StockTransferController } from '../controllers/StockTransferController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/', StockTransferController.getAll);
router.get('/:id', StockTransferController.getById);
router.post('/', StockTransferController.create);
router.post('/:id/complete', StockTransferController.complete);

export default router;
