import { Router } from 'express';
import { GeneralLedgerController } from '../controllers/GeneralLedgerController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes require authentication and manager/admin role
router.use(authenticate);
router.use(authorize('admin', 'manager'));

router.get('/', GeneralLedgerController.getAll);
router.get('/chart-of-accounts', GeneralLedgerController.getChartOfAccounts);
router.get('/trial-balance', GeneralLedgerController.getTrialBalance);
router.get('/account/:id/ledger', GeneralLedgerController.getAccountLedger);
router.get('/document/:pieceType/:pieceId', GeneralLedgerController.getByDocument);
router.post('/manual-entry', GeneralLedgerController.createManualEntry);
router.get('/stats', GeneralLedgerController.getStats);
router.get('/journal-breakdown', GeneralLedgerController.getJournalBreakdown);

export default router;
