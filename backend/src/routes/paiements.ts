import { Router } from 'express';
import { PaiementController } from '../controllers/PaiementController';
import { validateBody } from '../middleware/validation';
import { createPaiementSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Get all payments (with pagination and filters)
router.get('/', PaiementController.getAll);

// Get payment statistics
router.get('/stats', PaiementController.getStats);

// Update a payment (admin, manager only)
router.put('/:id', authorize(['admin', 'manager']), PaiementController.update);

// Delete a payment (admin only)
router.delete('/:id', authorize(['admin']), PaiementController.delete);

// Create standalone payment
router.post('/', validateBody(createPaiementSchema), PaiementController.create);

export default router;
