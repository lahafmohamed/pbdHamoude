import { Router } from 'express';
import { TiersController } from '../controllers/TiersController';
import pool from '../db/connection';
import { authenticate, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createTiersSchema, updateTiersSchema, createCompensationSchema } from '../validation/schemas';

const router = Router();
router.use(authenticate);

// List & search
router.get('/', TiersController.getAll);
router.get('/search', TiersController.search);

// CRUD
router.post('/', authorize(['admin', 'manager']), validateBody(createTiersSchema), TiersController.create);
router.get('/:id', TiersController.getById);
router.put('/:id', authorize(['admin', 'manager']), validateBody(updateTiersSchema), TiersController.update);
router.delete('/:id', authorize(['admin']), TiersController.delete);

// Role promotion
router.patch('/:id/promouvoir', authorize(['admin', 'manager']), TiersController.promouvoir);

// Compte (unified ledger + balances)
router.get('/:id/compte', TiersController.getCompte);

// Acomptes
router.post('/:id/acomptes-client', TiersController.recordAcompteClient);
router.post('/:id/acomptes-fournisseur', authorize(['admin', 'manager']), TiersController.recordAcompteFournisseur);

// List available acomptes (montant_restant > 0)
router.get('/:id/acomptes-fournisseur/disponibles', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ac.*, t.raison_sociale AS tiers_nom
       FROM acomptes_fournisseur ac
       JOIN tiers t ON ac.tiers_id = t.id
       WHERE ac.tiers_id = $1
         AND ac.deleted_at IS NULL
         AND ac.statut IN ('disponible','partiellement_utilise')
         AND ac.montant_restant > 0
       ORDER BY ac.date_acompte ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/acomptes-client/disponibles', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ac.*, t.raison_sociale AS tiers_nom
       FROM acomptes_clients ac
       JOIN tiers t ON ac.tiers_id = t.id
       WHERE ac.tiers_id = $1
         AND ac.deleted_at IS NULL
         AND ac.statut IN ('disponible','partiellement_utilise')
         AND ac.montant_restant > 0
       ORDER BY ac.date_acompte ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Compensation (netting)
router.get('/:id/compensations', TiersController.getCompensations);
router.post('/:id/compensation', authorize(['admin', 'manager']), validateBody(createCompensationSchema), TiersController.createCompensation);

// FIFO recompute (admin)
router.post('/:id/recompute-allocation', authorize(['admin']), TiersController.recomputeAllocation);

export default router;
