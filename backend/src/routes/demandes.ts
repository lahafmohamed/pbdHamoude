import { Router } from 'express';
import { DemandeController } from '../controllers/DemandeController';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireLocationAccess, Permissions } from '../middleware/permissions';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================
// DEMANDE CRUD
// ============================================

// List demandes (role-filtered automatically)
router.get('/', DemandeController.getAll);

// Get single demande
router.get('/:id', DemandeController.getById);

// Create demande (magasin staff)
router.post(
    '/',
    requirePermission(Permissions.DEMANDE_CREATE),
    DemandeController.create
);

// Update demande (brouillon only, own demandes)
router.put(
    '/:id',
    requirePermission(Permissions.DEMANDE_UPDATE),
    DemandeController.update
);

// ============================================
// STATE TRANSITIONS
// ============================================

// Send demande (brouillon -> envoyee)
router.post(
    '/:id/envoyer',
    requirePermission(Permissions.DEMANDE_SEND),
    DemandeController.send
);

// Decide (approve/reject) - depot staff
router.post(
    '/:id/decider',
    requirePermission(Permissions.DEMANDE_DECIDE),
    DemandeController.decide
);

// Execute (create transfer) - depot staff
router.post(
    '/:id/executer',
    requirePermission(Permissions.DEMANDE_EXECUTE),
    DemandeController.execute
);

// Close (magasin confirms receipt)
router.post(
    '/:id/cloturer',
    requirePermission(Permissions.DEMANDE_CLOSE),
    DemandeController.close
);

// Cancel (brouillon or envoyee)
router.post(
    '/:id/annuler',
    requirePermission(Permissions.DEMANDE_CANCEL),
    DemandeController.cancel
);

// ============================================
// UTILITY
// ============================================

// Get depot stock for magasin planning (read-only)
router.get(
    '/stock/depot',
    requirePermission(Permissions.STOCK_DEPOT_VIEW),
    DemandeController.getDepotStock
);

export default router;
