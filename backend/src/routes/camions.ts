import { Router } from 'express';
import { CamionController } from '../controllers/CamionController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Fleet management
router.get('/', CamionController.getAllCamions);
router.post('/', authorize('admin', 'manager'), CamionController.createCamion);
router.get('/ravitaillements', CamionController.getAllRavitaillements);
router.get('/stats', CamionController.getStats);
router.get('/:id', CamionController.getCamionById);
router.put('/:id', authorize('admin', 'manager'), CamionController.updateCamion);
router.delete('/:id', authorize('admin', 'manager'), CamionController.desactiverCamion);
router.get('/:id/ravitaillements', CamionController.getRavitaillements);
router.post('/:id/ravitaillements', CamionController.createRavitaillement);
router.get('/:id/stats', CamionController.getStats);

export default router;
