import { Router } from 'express';
import { ProduitController } from '../controllers/ProduitController';
import { validateBody, validateQuery } from '../middleware/validation';
import { createProduitSchema, updateProduitSchema, adjustStockSchema, stockMovementSchema } from '../validation/schemas';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Magasin-only endpoints used by Ventes (Factures, Devis) — must precede `/:id`.
router.get('/ventes/locations', ProduitController.getVentesLocations);
router.get('/ventes', ProduitController.getAllVentes);

router.get('/search/fuzzy', ProduitController.searchFuzzy);
router.get('/suggestions', ProduitController.getSuggestions);

router.get('/', ProduitController.getAll);
router.get('/alertes-stock', ProduitController.getAlertesStock);
router.get('/stock-valuation', ProduitController.getStockValuation);
router.get('/stock-by-category', ProduitController.getStockByCategory);
router.get('/:id', ProduitController.getById);
router.get('/:id/mouvements', ProduitController.getStockHistory);
router.post('/', validateBody(createProduitSchema), ProduitController.create);
router.put('/:id', validateBody(updateProduitSchema), ProduitController.update);
router.delete('/:id', ProduitController.delete);
router.patch('/:id/stock', validateBody(adjustStockSchema), ProduitController.adjustStock);
router.post('/:id/mouvements', validateBody(stockMovementSchema), ProduitController.addStockMovement);

export default router;
