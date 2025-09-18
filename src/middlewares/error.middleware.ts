import { Request, Response, NextFunction } from 'express';
import Logger from '../utils/winstonLogger.utils'; // adjust path

interface CustomError extends Error {
  status?: number;
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.status ?? 500;
  const message = err.message ?? 'Internal Server Error';

  // Structured logging
  Logger.error(
    `${req.method} ${req.originalUrl} | ${statusCode} - ${message} \nStack: ${err.stack ?? 'N/A'}`
  );

  res.status(statusCode).json({
    success: false,
    statusCode,
    message
  });
};
