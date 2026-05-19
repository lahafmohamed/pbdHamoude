import { Request, Response, Router } from 'express';
import { taxReportService } from '../services/TaxReportService';
import { authenticate } from '../middleware/auth';

const router = Router();

// All tax report routes require authentication
router.use(authenticate);

// Get TVA collected report
router.get('/tva', async (req: Request, res: Response) => {
  try {
    const { date_debut, date_fin } = req.query;

    if (!date_debut || !date_fin) {
      // Default to current month
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      
      const report = await taxReportService.getTVACollected(firstDay, lastDay);
      res.json({ success: true, data: report });
      return;
    }

    const report = await taxReportService.getTVACollected(date_debut as string, date_fin as string);
    res.json({ success: true, data: report });
  } catch (error: any) {
    console.error('Erreur GET /api/reports/tva:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get monthly TVA summary
router.get('/tva/monthly', async (req: Request, res: Response) => {
  try {
    const { annee } = req.query;
    const year = annee ? parseInt(annee as string) : new Date().getFullYear();
    
    const monthlyData = await taxReportService.getMonthlyTVASummary(year);
    res.json({ success: true, data: monthlyData });
  } catch (error: any) {
    console.error('Erreur GET /api/reports/tva/monthly:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
