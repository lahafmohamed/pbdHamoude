import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { AdminUserController } from '../controllers/AdminUserController';

const router = Router();

// Toutes les routes nécessitent d'être authentifié et d'avoir la permission 'users.manage'
router.use(authenticate, requirePermission('users.manage'));

router.get('/', AdminUserController.getUsers);
router.post('/', AdminUserController.createUser);
router.put('/:id', AdminUserController.updateUser);

router.get('/roles', AdminUserController.getRoles);
router.get('/permissions', AdminUserController.getPermissions);

router.get('/:id/permissions', AdminUserController.getUserPermissions);
router.post('/:id/permissions', AdminUserController.updateUserPermissions);

export default router;
