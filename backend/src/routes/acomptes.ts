import { Router } from 'express';
import { AcompteController } from '../controllers/AcompteController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/:id', AcompteController.getById);
router.get('/:id/applications', AcompteController.listApplications);
router.post('/:id/apply', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), AcompteController.apply);
router.post('/:id/refund', authorize(['admin', 'manager']), AcompteController.refund);

// Supplier acomptes — separate path to avoid id collision with client acomptes
router.get('/fournisseur/:id', AcompteController.getByIdFournisseur);
router.get('/fournisseur/:id/applications', AcompteController.listApplicationsFournisseur);
router.post('/fournisseur/:id/apply', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), AcompteController.applyFournisseur);
router.post('/fournisseur/:id/refund', authorize(['admin', 'manager']), AcompteController.refundFournisseur);

export default router;
