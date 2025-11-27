import { Request, Response, NextFunction } from 'express';

export const validatePayoutQuery = (req: Request, res: Response, next: NextFunction) => {
  const errors: string[] = [];

  // Validate lesson type
  if (req.query.lessonType) {
    const validLessonTypes = ['1-on-1', 'group'];
    if (!validLessonTypes.includes(req.query.lessonType as string)) {
      errors.push('Invalid lesson type. Must be "1-on-1" or "group"');
    }
  }

  // Validate payment status
  if (req.query.paymentStatus) {
    const validStatuses = ['PENDING', 'SENT', 'FAILED', 'SETTLED'];
    if (!validStatuses.includes(req.query.paymentStatus as string)) {
      errors.push('Invalid payment status');
    }
  }

  // Validate amount range
  if (req.query.amountRange) {
    const validRanges = ['0-50', '50-100', '100-150', '150-200'];
    if (!validRanges.includes(req.query.amountRange as string)) {
      errors.push('Invalid amount range');
    }
  }

  // Validate dates
  if (req.query.startDate) {
    const startDate = new Date(req.query.startDate as string);
    if (isNaN(startDate.getTime())) {
      errors.push('Invalid start date format');
    }
  }

  if (req.query.endDate) {
    const endDate = new Date(req.query.endDate as string);
    if (isNaN(endDate.getTime())) {
      errors.push('Invalid end date format');
    }
  }

  // Validate pagination
  if (req.query.page) {
    const page = parseInt(req.query.page as string);
    if (isNaN(page) || page < 1) {
      errors.push('Page must be a positive number');
    }
  }

  if (req.query.limit) {
    const limit = parseInt(req.query.limit as string);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      errors.push('Limit must be between 1 and 100');
    }
  }

  // Validate sort order
  if (req.query.sortOrder) {
    const validSortOrders = ['asc', 'desc'];
    if (!validSortOrders.includes(req.query.sortOrder as string)) {
      errors.push('Sort order must be "asc" or "desc"');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};
