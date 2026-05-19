import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserLocationAssignmentController } from '../controllers/UserLocationAssignmentController';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'manager'));

router.get('/users', UserLocationAssignmentController.getUsers);
router.get('/locations', UserLocationAssignmentController.getLocations);
router.get('/:userId', UserLocationAssignmentController.getByUserId);
router.put('/:userId', UserLocationAssignmentController.update);

export default router;
