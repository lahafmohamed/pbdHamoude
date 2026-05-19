import { Router } from 'express';
import { CommandeController } from '../controllers/CommandeController';
import { validateBody } from '../middleware/validation';
import { createCommandeSchema, updateCommandeStatutSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', CommandeController.getAll);
router.get('/stats', CommandeController.getStats);
router.get('/:id', CommandeController.getById);
router.post('/', authorize(['admin', 'manager', 'depot_staff']), validateBody(createCommandeSchema), CommandeController.create);
router.put('/:id/statut', authorize(['admin', 'manager', 'depot_staff']), validateBody(updateCommandeStatutSchema), CommandeController.updateStatut);
router.delete('/:id', authorize(['admin']), CommandeController.delete);

export default router;
