import { Router } from 'express';
import { BonLivraisonController } from '../controllers/BonLivraisonController';
import { validateBody } from '../middleware/validation';
import { createBonLivraisonSchema, updateBonLivraisonSchema, updateBonLivraisonStatutSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/bons-livraison - Get all delivery notes
router.get('/', BonLivraisonController.getAll);

// GET /api/bons-livraison/:id - Get delivery note by ID
router.get('/:id', BonLivraisonController.getById);

// GET /api/bons-livraison/:id/pdf - Generate PDF
router.get('/:id/pdf', BonLivraisonController.generatePDF);

// POST /api/bons-livraison - Create delivery note (admin, manager only)
router.post('/', authorize(['admin', 'manager', 'magasin_staff']), validateBody(createBonLivraisonSchema), BonLivraisonController.create);

// PUT /api/bons-livraison/:id - Update delivery note (admin, manager only)
router.put('/:id', authorize(['admin', 'manager', 'magasin_staff']), validateBody(updateBonLivraisonSchema), BonLivraisonController.update);

// PATCH /api/bons-livraison/:id/statut - Update status (admin, manager only)
router.patch('/:id/statut', authorize(['admin', 'manager', 'magasin_staff']), validateBody(updateBonLivraisonStatutSchema), BonLivraisonController.updateStatut);

// POST /api/bons-livraison/:id/convert - Convert to invoice (admin, manager only)
router.post('/:id/convert', authorize(['admin', 'manager', 'magasin_staff']), BonLivraisonController.convertToFacture);

// DELETE /api/bons-livraison/:id - Delete (admin only)
router.delete('/:id', authorize(['admin']), BonLivraisonController.delete);

export default router;
