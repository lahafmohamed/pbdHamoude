import { Router } from 'express';
import { ReportingController } from '../controllers/ReportingController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorize(['admin', 'manager']));

router.get('/dashboard', ReportingController.getDashboardKPIs);
router.get('/pnl', ReportingController.getPnL);
router.get('/receivables', ReportingController.getReceivablesAging);
router.get('/inventory', ReportingController.getInventoryValuation);
router.get('/turnover', ReportingController.getInventoryTurnover);
router.get('/sales-by-category', ReportingController.getSalesByCategory);
router.get('/products', ReportingController.getProductPerformance);

export default router;
