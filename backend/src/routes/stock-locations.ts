import { Router } from 'express';
import { StockLocationController } from '../controllers/StockLocationController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/', StockLocationController.getAll);
router.get('/:id', StockLocationController.getById);
router.post('/', StockLocationController.create);
router.get('/:id/stock', StockLocationController.getStockLevels);
router.get('/:id/products-with-stock', StockLocationController.getProductsWithStock);

export default router;
