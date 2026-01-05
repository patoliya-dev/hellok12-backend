import { Request, Response } from 'express';
import { InvitationService } from './invitation.service';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';

export const invitationController = {
  validateInvitation: async (req: Request, res: Response) => {
    try {
      const { inviteId, ticket } = req.query;
      const data = await InvitationService.validate(inviteId as string, ticket as string);
      return res.json(createSuccessResponse(data, 'Invitation valid'));
    } catch (e: any) {
      return res
        .status(e.statusCode || 400)
        .json(createErrorResponse(e.message, 'Invalid invitation'));
    }
  },

  acceptInvitation: async (req: Request, res: Response) => {
    try {
      const out = await InvitationService.accept(req.body);
      return res.json(createSuccessResponse(out, 'Invitation accepted'));
    } catch (e: any) {
      return res.status(e.statusCode || 400).json(createErrorResponse(e.message, 'Accept failed'));
    }
  }
};
