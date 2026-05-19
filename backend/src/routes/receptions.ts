import { Router } from 'express';
import { ReceptionController } from '../controllers/ReceptionController';
import { validateBody } from '../middleware/validation';
import { createReceptionSchema } from '../validation/phase3-schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', ReceptionController.getAll);
router.get('/pending', ReceptionController.getPendingOrders);
router.get('/order/:commandeId', ReceptionController.getOrderDetails);
router.get('/stats', ReceptionController.getStats);
router.get('/:id', ReceptionController.getById);
router.post('/', authorize(['admin', 'manager', 'depot_staff']), validateBody(createReceptionSchema), ReceptionController.create);
router.delete('/:id', authorize(['admin']), ReceptionController.delete);

export default router;
