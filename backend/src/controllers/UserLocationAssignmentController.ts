import { Request, Response } from 'express';
import { successResponse } from '../utils/response';
import { userLocationAssignmentService } from '../services/UserLocationAssignmentService';
import { AuthRequest } from '../middleware/auth';

export class UserLocationAssignmentController {
  static async getUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await userLocationAssignmentService.getUsers();
      successResponse(res, users, 'Utilisateurs recuperes avec succes');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getLocations(_req: Request, res: Response): Promise<void> {
    try {
      const locations = await userLocationAssignmentService.getLocations();
      successResponse(res, locations, 'Locations recuperees avec succes');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async getByUserId(req: Request, res: Response): Promise<void> {
    try {
      const userId = parseInt(req.params.userId, 10);
      if (Number.isNaN(userId)) {
        res.status(400).json({ success: false, error: 'ID utilisateur invalide' });
        return;
      }

      const userAssignments = await userLocationAssignmentService.getByUserId(userId);
      if (!userAssignments) {
        res.status(404).json({ success: false, error: 'Utilisateur non trouve' });
        return;
      }

      successResponse(res, userAssignments, 'Affectations recuperees avec succes');
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = parseInt(req.params.userId, 10);
      if (Number.isNaN(userId)) {
        res.status(400).json({ success: false, error: 'ID utilisateur invalide' });
        return;
      }

      const locationIds = Array.isArray(req.body.location_ids)
        ? req.body.location_ids
            .map((id: any) => parseInt(String(id), 10))
            .filter((id: number) => !Number.isNaN(id))
        : [];

      const defaultLocationId = req.body.default_location_id
        ? parseInt(String(req.body.default_location_id), 10)
        : null;

      await userLocationAssignmentService.updateAssignments(
        userId,
        locationIds,
        Number.isNaN(defaultLocationId as number) ? null : defaultLocationId,
        req.user?.id,
        req
      );

      successResponse(res, null, 'Affectations mises a jour avec succes');
    } catch (error: any) {
      const status =
        /non trouve|invalides|inactives|defaut|affectee/.test(error.message)
          ? 400
          : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  }
}
