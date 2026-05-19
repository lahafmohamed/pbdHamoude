import { Router } from 'express';
import { DepenseControllerV2 } from '../controllers/DepenseControllerV2';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/depenses - Get all expenses with filters
router.get('/', DepenseControllerV2.getAll);

// GET /api/depenses/:id - Get expense by ID
router.get('/:id', DepenseControllerV2.getById);

// POST /api/depenses - Create expense (admin, manager, caissier, magasin_staff)
router.post('/', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), DepenseControllerV2.create);

// PUT /api/depenses/:id - Update expense (admin, manager, caissier, magasin_staff - own magasin only)
router.put('/:id', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), DepenseControllerV2.update);

// DELETE /api/depenses/:id - Delete expense (admin, manager, caissier, magasin_staff - own magasin only)
router.delete('/:id', authorize(['admin', 'manager', 'caissier', 'magasin_staff']), DepenseControllerV2.delete);

// GET /api/depenses/categories/list - Get expense categories
router.get('/categories/list', DepenseControllerV2.getCategories);

// GET /api/depenses/reports/by-location - Report by location
router.get('/reports/by-location', authorize(['admin', 'manager']), DepenseControllerV2.reportByLocation);

// GET /api/depenses/reports/by-categorie - Report by category
router.get('/reports/by-categorie', authorize(['admin', 'manager']), DepenseControllerV2.reportByCategorie);

export default router;
