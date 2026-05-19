import { Router } from 'express';
import { productImportService } from '../services/ProductImportService';
import { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { productImportSchema } from '../validation/phase3-schemas';
import { z } from 'zod';

const router = Router();

const importArraySchema = z.array(productImportSchema).min(1).max(1000);

// Export products to CSV
router.get('/export', async (req, res) => {
  try {
    const csv = await productImportService.exportToCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="produits_export.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de l\'export' });
  }
});

// Validate import data
router.post('/validate', validateBody(importArraySchema), async (req, res) => {
  try {
    const result = await productImportService.validate(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur de validation' });
  }
});

// Import products
router.post('/import', validateBody(importArraySchema), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const result = await productImportService.import(req.body, authReq.user?.id);
    res.json({ success: true, data: result, message: 'Import terminé' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de l\'import' });
  }
});

export default router;
