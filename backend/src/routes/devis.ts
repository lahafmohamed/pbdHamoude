import { Router } from 'express';
import { DevisController } from '../controllers/DevisController';
import { validateBody } from '../middleware/validation';
import { createDevisSchema, updateDevisSchema, updateDevisStatutSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/devis - Get all quotes
router.get('/', DevisController.getAll);

// GET /api/devis/:id - Get quote by ID
router.get('/:id', DevisController.getById);

// GET /api/devis/:id/pdf - Generate PDF
router.get('/:id/pdf', DevisController.generatePDF);

// POST /api/devis - Create new quote (admin, manager only)
router.post('/', authorize(['admin', 'manager', 'magasin_staff']), validateBody(createDevisSchema), DevisController.create);

// PUT /api/devis/:id - Update quote (admin, manager only)
router.put('/:id', authorize(['admin', 'manager', 'magasin_staff']), validateBody(updateDevisSchema), DevisController.update);

// PATCH /api/devis/:id/statut - Update quote status (admin, manager only)
router.patch('/:id/statut', authorize(['admin', 'manager', 'magasin_staff']), validateBody(updateDevisStatutSchema), DevisController.updateStatut);

// POST /api/devis/:id/convert - Convert quote to invoice (admin, manager only)
router.post('/:id/convert', authorize(['admin', 'manager', 'magasin_staff']), DevisController.convertToFacture);

// DELETE /api/devis/:id - Delete quote (admin only)
router.delete('/:id', authorize(['admin']), DevisController.delete);

export default router;
