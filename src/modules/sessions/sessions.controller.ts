import { Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { AuthenticatedRequest } from '../../middlewares/auth';
import sessionService from './sessions.service';

export const completeSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = String((req as any)?.validatedParams?.id || req.params?.id || '');
    const note = (req as any)?.validatedBody?.note;
    const teacherId = req.user?.id;

    if (!teacherId) {
      return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
    }

    const result = await sessionService.completeSessionByTeacher({
      sessionId,
      teacherId,
      note
    });

    return res.status(200).json(
      createSuccessResponse(
        {
          session: result.session,
          alreadyCompleted: result.alreadyCompleted
        },
        result.alreadyCompleted ? 'Session already completed' : 'Session marked as completed',
        200
      )
    );
  } catch (error: any) {
    const candidateStatus = Number(error?.statusCode);
    const statusCode =
      Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
        ? candidateStatus
        : 500;
    return res
      .status(statusCode)
      .json(
        createErrorResponse(error?.message || 'Failed to complete session', 'Error', statusCode)
      );
  }
};
