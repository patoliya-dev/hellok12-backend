import { Request, Response, NextFunction } from 'express';

/**
 * Validates query params used by earnings list and payout-after-commission screens.
 * This keeps filtering predictable and prevents expensive malformed DB scans.
 */
export const validatePayoutQuery = (req: Request, res: Response, next: NextFunction) => {
  const errors: string[] = [];

  // Validate lesson type
  if (req.query.lessonType) {
    const validLessonTypes = ['1-on-1', 'group'];
    if (!validLessonTypes.includes(req.query.lessonType as string)) {
      errors.push('Invalid lesson type. Must be "1-on-1" or "group"');
    }
  }

  // Validate transaction/payment status
  if (req.query.status) {
    const validStatuses = [
      'PAID',
      'SENT',
      'SETTLED',
      'SUCCEEDED',
      'COMPLETED',
      'PENDING',
      'PROCESSING',
      'FAILED',
      'REFUNDED'
    ];
    if (!validStatuses.includes(String(req.query.status).toUpperCase())) {
      errors.push('Invalid payment status');
    }
  }

  // Validate min/max amount
  if (req.query.minAmount !== undefined) {
    const minAmount = Number(req.query.minAmount);
    if (Number.isNaN(minAmount) || minAmount < 0) {
      errors.push('minAmount must be a non-negative number');
    }
  }

  if (req.query.maxAmount !== undefined) {
    const maxAmount = Number(req.query.maxAmount);
    if (Number.isNaN(maxAmount) || maxAmount < 0) {
      errors.push('maxAmount must be a non-negative number');
    }
  }

  if (req.query.minAmount !== undefined && req.query.maxAmount !== undefined) {
    const minAmount = Number(req.query.minAmount);
    const maxAmount = Number(req.query.maxAmount);
    if (!Number.isNaN(minAmount) && !Number.isNaN(maxAmount) && maxAmount < minAmount) {
      errors.push('maxAmount must be greater than or equal to minAmount');
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

  if (req.query.startDate && req.query.endDate) {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && endDate < startDate) {
      errors.push('endDate must be greater than or equal to startDate');
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

  if (req.query.sortBy) {
    const validSortBy = ['date', 'createdAt', 'amount', 'description', 'lessonService'];
    if (!validSortBy.includes(String(req.query.sortBy))) {
      errors.push('Invalid sortBy field');
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
