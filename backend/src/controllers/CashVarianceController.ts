import { Request, Response, Router } from 'express';
import { cashVarianceService } from '../services/CashVarianceService';
import { authenticate } from '../middleware/auth';

const router = Router();

// All cash variance routes require authentication
router.use(authenticate);

// Get daily cash variance
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    
    const reportDate = date ? (date as string) : new Date().toISOString().split('T')[0];
    const variance = await cashVarianceService.getDailyVariance(reportDate);
    
    res.json({ success: true, data: variance });
  } catch (error: any) {
    console.error('Erreur GET /api/reports/cash-variance/daily:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get cash variance for date range
router.get('/range', async (req: Request, res: Response) => {
  try {
    const { date_debut, date_fin } = req.query;
    
    if (!date_debut || !date_fin) {
      res.status(400).json({ error: 'date_debut et date_fin requis' });
      return;
    }
    
    const variance = await cashVarianceService.getVarianceRange(date_debut as string, date_fin as string);
    res.json({ success: true, data: variance });
  } catch (error: any) {
    console.error('Erreur GET /api/reports/cash-variance/range:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get user cash performance
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { date_debut, date_fin } = req.query;
    
    const startDate = date_debut ? (date_debut as string) : new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
    const endDate = date_fin ? (date_fin as string) : new Date().toISOString().split('T')[0];
    
    const performance = await cashVarianceService.getUserPerformance(
      parseInt(userId),
      startDate,
      endDate
    );
    
    res.json({ success: true, data: performance });
  } catch (error: any) {
    console.error('Erreur GET /api/reports/cash-variance/user:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
