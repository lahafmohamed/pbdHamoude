import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import produitsRoutes from './routes/produits';
import produitsImportRoutes from './routes/produits-import';
import tiersRoutes from './routes/tiers';
import clientsRoutes from './routes/clients';
import facturesRoutes from './routes/factures';
import paiementsRoutes from './routes/paiements';
import fournisseursRoutes from './routes/fournisseurs';
import commandesRoutes from './routes/commandes';
import authRoutes from './routes/auth';
import receptionsRoutes from './routes/receptions';
import retoursRoutes from './routes/retours';
import reportsRoutes from './routes/reports';
import caisseRoutes from './routes/caisse';
import posRoutes from './routes/pos';
import cashVarianceRoutes from './routes/cash-variance';
import comptesClientsRoutes from './routes/comptes-clients';
import acomptesRoutes from './routes/acomptes';
import stockLocationsRoutes from './routes/stock-locations';
import stockTransfersRoutes from './routes/stock-transfers';
import userLocationAssignmentsRoutes from './routes/user-location-assignments';
import demandesRoutes from './routes/demandes';
import facturesFournisseurRoutes from './routes/factures-fournisseur';
import generalLedgerRoutes from './routes/general-ledger';
import employesRoutes from './routes/employes';
import devisRoutes from './routes/devis';
import bonsLivraisonRoutes from './routes/bons-livraison';
import depensesRoutes from './routes/depenses';
import caissesHierarchyRoutes from './routes/caisses-hierarchy';
import avoirsRoutes from './routes/avoirs';
import adminAllocationRoutes from './routes/admin-allocation';
import adminUsersRoutes from './routes/admin-users';
import { logger, requestLogger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS - restrict to frontend origin
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:6001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { success: false, error: 'Trop de requêtes, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit auth attempts to 10 per 15 minutes
  message: { success: false, error: 'Trop de tentatives de connexion, veuillez réessayer plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (all environments)
app.use(requestLogger);

// Routes API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/produits', produitsRoutes);
app.use('/api/produits/import', produitsImportRoutes);
app.use('/api/tiers', tiersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/comptes', comptesClientsRoutes);
app.use('/api/acomptes', acomptesRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/paiements', paiementsRoutes);
app.use('/api/fournisseurs', fournisseursRoutes);
app.use('/api/commandes', commandesRoutes);
app.use('/api/receptions', receptionsRoutes);
app.use('/api/retours', retoursRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/caisse', caisseRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/reports/cash-variance', cashVarianceRoutes);
// ERP Modules
app.use('/api/stock-locations', stockLocationsRoutes);
app.use('/api/stock-transfers', stockTransfersRoutes);
app.use('/api/user-location-assignments', userLocationAssignmentsRoutes);
app.use('/api/demandes', demandesRoutes);
app.use('/api/factures-fournisseur', facturesFournisseurRoutes);
app.use('/api/general-ledger', generalLedgerRoutes);
app.use('/api/employes', employesRoutes);

// Phase 5 ERP Modules
app.use('/api/devis', devisRoutes);
app.use('/api/bons-livraison', bonsLivraisonRoutes);
app.use('/api/depenses', depensesRoutes);
app.use('/api/caisses-hierarchy', caissesHierarchyRoutes);
app.use('/api/avoirs', avoirsRoutes);
app.use('/api/admin/allocation', adminAllocationRoutes);
app.use('/api/admin/users', adminUsersRoutes);

// Health check (no rate limit)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

app.listen(PORT, () => {
  logger.info(`Backend démarré sur http://localhost:${PORT}`);
  logger.info(`API Health: http://localhost:${PORT}/api/health`);
});

export default app;
