import { Response } from 'express';
import { Types } from 'mongoose';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { ScheduleService } from './schedule.service';
import { ValidatedRequest } from '../../middlewares/validation';

export const getSchedule = async (req: ValidatedRequest, res: Response) => {
  try {
    const teacherId = new Types.ObjectId(req.params.teacherId);
    const data = await ScheduleService.get(teacherId);
    if (!data) {
      return res.status(404).json(createErrorResponse('Schedule not found', '404_NOT_FOUND', 404));
    }
    return res.status(200).json(createSuccessResponse(data, 'Schedule fetched', 200));
  } catch (e: any) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to fetch schedule', 'Internal Server Error', 500));
  }
};

export const upsertWeekly = async (req: ValidatedRequest, res: Response) => {
  try {
    const teacherId = new Types.ObjectId(req.params.teacherId);
    const updated = await ScheduleService.upsertWeekly(teacherId, req.validatedBody || req.body);
    return res.status(200).json(createSuccessResponse(updated, 'Schedule saved', 200));
  } catch (e: any) {
    if (e?.code === '422_VALIDATION') {
      return res
        .status(422)
        .json(
          createErrorResponse(
            e.message,
            '422_VALIDATION',
            422,
            e.fields ? { fields: e.fields } : undefined
          )
        );
    }
    return res
      .status(500)
      .json(createErrorResponse('Failed to save schedule', 'Internal Server Error', 500));
  }
};

export const getSlotsForDate = async (req: ValidatedRequest, res: Response) => {
  try {
    const teacherId = new Types.ObjectId(req.params.teacherId);
    const { date } = req.validatedQuery || req.query;
    const data = await ScheduleService.getSlotsForDate(teacherId, String(date));
    return res.status(200).json(createSuccessResponse(data, 'Slots fetched', 200));
  } catch (e: any) {
    if (e?.code === '404_NOT_FOUND') {
      return res.status(404).json(createErrorResponse('Schedule not found', '404_NOT_FOUND', 404));
    }
    return res
      .status(500)
      .json(createErrorResponse('Failed to fetch slots', 'Internal Server Error', 500));
  }
};

export const patchDateSlots = async (req: ValidatedRequest, res: Response) => {
  try {
    const teacherId = new Types.ObjectId(req.params.teacherId);
    const data = await ScheduleService.patchDateSlots(teacherId, req.validatedBody || req.body);
    return res.status(200).json(createSuccessResponse(data, 'Date slots updated', 200));
  } catch (e: any) {
    if (e?.code === '422_VALIDATION') {
      return res
        .status(422)
        .json(
          createErrorResponse(
            e.message,
            '422_VALIDATION',
            422,
            e.fields ? { fields: e.fields } : undefined
          )
        );
    }
    return res
      .status(500)
      .json(createErrorResponse('Failed to update date slots', 'Internal Server Error', 500));
  }
};

export const validateLessonBlock = async (req: ValidatedRequest, res: Response) => {
  try {
    const teacherId = new Types.ObjectId(req.params.teacherId);
    const result = await ScheduleService.validateBlock(teacherId, req.validatedBody || req.body);
    return res.status(200).json(createSuccessResponse(result, 'Validated', 200));
  } catch (e: any) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to validate block', 'Internal Server Error', 500));
  }
};
