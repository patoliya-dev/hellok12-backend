import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodTypeAny, ZodIssue } from 'zod';
import { createErrorResponse } from '../utils/apiResponse';

// Define file interface without relying on Express.Multer
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination?: string;
  filename?: string;
  path?: string;
  buffer?: Buffer;
}

// Extend Request to include file properties
interface ValidatedRequest extends Request {
  validatedBody?: any;
  validatedQuery?: any;
  validatedParams?: any;
  // Add file properties for file upload compatibility
  file?: UploadedFile;
  files?: UploadedFile[] | { [fieldname: string]: UploadedFile[] };
}

// Main validation middleware that stores validated data
export const validateRequest = (schema: ZodSchema) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<any> => {
    try {
      const validated = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      })) as { body: any; query: any; params: any };

      // Store validated data in request object
      req.validatedBody = validated.body;
      req.validatedQuery = validated.query;
      req.validatedParams = validated.params;

      next();
    } catch (error) {
      // Handle Zod validation errors cleanly
      if (error instanceof ZodError) {
        const fields = error.issues.map((issue: ZodIssue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          received: (issue as any).received ?? (issue as any).input ?? 'invalid'
        }));

        // Return structured details instead of JSON.stringify
        return res
          .status(400)
          .json(createErrorResponse('Validation failed', 'VALIDATION_FAILED', 400, { fields }));
      }

      // Catch any unexpected middleware errors
      return res
        .status(500)
        .json(
          createErrorResponse('Internal server error during validation', 'VALIDATION_ERROR', 500)
        );
    }
  };
};

// Validation middleware for body only
export const validateBody = (schema: ZodTypeAny) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.validatedBody = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue: ZodIssue) => {
          const errorObj: any = {
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code
          };

          if ('received' in issue && issue.received !== undefined) {
            errorObj.received = issue.received;
          } else {
            errorObj.received = 'invalid';
          }

          return errorObj;
        });

        res
          .status(400)
          .json(
            createErrorResponse(
              JSON.stringify(errorMessages),
              'Request body validation failed',
              400
            )
          );
        return;
      }

      console.error('Body validation error:', error);
      res
        .status(500)
        .json(
          createErrorResponse(
            'Internal server error during body validation',
            'Validation error',
            500
          )
        );
    }
  };
};

// Validation middleware for route parameters only
export const validateParams = (schema: ZodTypeAny) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.validatedParams = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue: ZodIssue) => {
          const errorObj: any = {
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code
          };

          if ('received' in issue && issue.received !== undefined) {
            errorObj.received = issue.received;
          } else {
            errorObj.received = 'invalid';
          }

          return errorObj;
        });

        res
          .status(400)
          .json(
            createErrorResponse(
              JSON.stringify(errorMessages),
              'Route parameters validation failed',
              400
            )
          );
        return;
      }

      console.error('Params validation error:', error);
      res
        .status(500)
        .json(
          createErrorResponse(
            'Internal server error during params validation',
            'Validation error',
            500
          )
        );
    }
  };
};

// Export types and interfaces
export { ValidatedRequest, UploadedFile };
