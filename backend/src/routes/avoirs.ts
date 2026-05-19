import { Router } from 'express';
import { CreditNoteController } from '../controllers/CreditNoteController';
import { validateBody } from '../middleware/validation';
import { createAvoirFromRetourSchema, createAvoirManualSchema, updateAvoirStatutSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/avoirs - Get all credit notes
router.get('/', CreditNoteController.getAll);

// GET /api/avoirs/:id - Get credit note by ID
router.get('/:id', CreditNoteController.getById);

// GET /api/avoirs/:id/pdf - Generate PDF
router.get('/:id/pdf', CreditNoteController.generatePDF);

// POST /api/avoirs/from-retour - Create from return (admin, manager only)
router.post('/from-retour', authorize(['admin', 'manager']), validateBody(createAvoirFromRetourSchema), CreditNoteController.createFromRetour);

// POST /api/avoirs/manual - Create manual credit note (admin, manager only)
router.post('/manual', authorize(['admin', 'manager']), validateBody(createAvoirManualSchema), CreditNoteController.createManual);

// PATCH /api/avoirs/:id/statut - Update statut (admin, manager only)
router.patch('/:id/statut', authorize(['admin', 'manager']), validateBody(updateAvoirStatutSchema), CreditNoteController.updateStatut);

// POST /api/avoirs/:id/apply-to-facture - Apply credit note to an invoice (admin, manager only)
router.post('/:id/apply-to-facture', authorize(['admin', 'manager']), CreditNoteController.applyToFacture);

// DELETE /api/avoirs/:id - Delete (admin only)
router.delete('/:id', authorize(['admin']), CreditNoteController.delete);

export default router;
