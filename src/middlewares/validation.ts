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

// Alternative validation middleware that doesn't store data (for optional validation)
export const validateRequestOptional = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      });
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
          } else if ('input' in issue && issue.input !== undefined) {
            errorObj.received = (issue as any).input;
          } else {
            errorObj.received = 'invalid';
          }

          return errorObj;
        });

        res
          .status(400)
          .json(createErrorResponse(JSON.stringify(errorMessages), 'Validation failed', 400));
        return;
      }

      console.error('Optional validation middleware error:', error);
      res
        .status(500)
        .json(
          createErrorResponse('Internal server error during validation', 'Validation error', 500)
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

// Validation middleware for query parameters only
export const validateQuery = (schema: ZodTypeAny) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.query);
      req.validatedQuery = validated;
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
              'Query parameters validation failed',
              400
            )
          );
        return;
      }

      console.error('Query validation error:', error);
      res
        .status(500)
        .json(
          createErrorResponse(
            'Internal server error during query validation',
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

// Enhanced validation middleware with custom error formatting
export const validateRequestWithFormatting = (
  schema: ZodSchema,
  options?: {
    formatErrors?: boolean;
    includeErrorCode?: boolean;
    customErrorMessage?: string;
  }
) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      })) as { body: any; query: any; params: any };

      req.validatedBody = validated.body;
      req.validatedQuery = validated.query;
      req.validatedParams = validated.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        let errorMessages: any;

        if (options?.formatErrors) {
          // Formatted error messages for better UX
          errorMessages = error.issues.reduce((acc: Record<string, string[]>, issue: ZodIssue) => {
            const field = issue.path.join('.');
            const message = issue.message;

            if (!acc[field]) {
              acc[field] = [];
            }
            acc[field].push(message);

            return acc;
          }, {});
        } else {
          // Standard error format
          errorMessages = error.issues.map((issue: ZodIssue) => {
            const errorObj: any = {
              path: issue.path.join('.'),
              message: issue.message
            };

            if (options?.includeErrorCode) {
              errorObj.code = issue.code;
            }

            if ('received' in issue && issue.received !== undefined) {
              errorObj.received = issue.received;
            } else {
              errorObj.received = 'invalid';
            }

            return errorObj;
          });
        }

        res
          .status(400)
          .json(
            createErrorResponse(
              JSON.stringify(errorMessages),
              options?.customErrorMessage || 'Validation failed',
              400
            )
          );
        return;
      }

      console.error('Enhanced validation middleware error:', error);
      res
        .status(500)
        .json(
          createErrorResponse('Internal server error during validation', 'Validation error', 500)
        );
    }
  };
};

// Validation middleware that handles file uploads
export const validateWithFiles = (
  schema: ZodSchema,
  maxFileSize: number = 5 * 1024 * 1024, // 5MB default
  allowedMimeTypes: string[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate files if present
      if (req.files || req.file) {
        let filesToValidate: UploadedFile[] = [];

        if (req.file) {
          filesToValidate = [req.file];
        } else if (req.files) {
          if (Array.isArray(req.files)) {
            filesToValidate = req.files;
          } else {
            // Handle object with field names
            filesToValidate = Object.values(req.files).flat();
          }
        }

        for (const file of filesToValidate) {
          if (file) {
            // Check file size
            if (file.size > maxFileSize) {
              res
                .status(400)
                .json(
                  createErrorResponse(
                    `File ${file.originalname} exceeds maximum size of ${maxFileSize / (1024 * 1024)}MB`,
                    'File validation failed',
                    400
                  )
                );
              return;
            }

            // Check MIME type
            if (!allowedMimeTypes.includes(file.mimetype)) {
              res
                .status(400)
                .json(
                  createErrorResponse(
                    `File type ${file.mimetype} is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
                    'File validation failed',
                    400
                  )
                );
              return;
            }
          }
        }
      }

      // Validate request data
      const validated = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      })) as { body: any; query: any; params: any };

      req.validatedBody = validated.body;
      req.validatedQuery = validated.query;
      req.validatedParams = validated.params;

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
          .json(createErrorResponse(JSON.stringify(errorMessages), 'Validation failed', 400));
        return;
      }

      console.error('File validation middleware error:', error);
      res
        .status(500)
        .json(
          createErrorResponse('Internal server error during validation', 'Validation error', 500)
        );
    }
  };
};

// Validation middleware factory for different content types
export const createValidator = (
  schema: ZodSchema,
  target: 'body' | 'query' | 'params' | 'all' = 'all'
) => {
  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      let dataToValidate: any;

      switch (target) {
        case 'body':
          dataToValidate = req.body;
          break;
        case 'query':
          dataToValidate = req.query;
          break;
        case 'params':
          dataToValidate = req.params;
          break;
        case 'all':
        default:
          dataToValidate = {
            body: req.body,
            query: req.query,
            params: req.params
          };
          break;
      }

      const validated = await schema.parseAsync(dataToValidate);

      if (target === 'all') {
        const validatedData = validated as { body: any; query: any; params: any };
        req.validatedBody = validatedData.body;
        req.validatedQuery = validatedData.query;
        req.validatedParams = validatedData.params;
      } else {
        // Use explicit property assignment instead of dynamic key access
        switch (target) {
          case 'body':
            req.validatedBody = validated;
            break;
          case 'query':
            req.validatedQuery = validated;
            break;
          case 'params':
            req.validatedParams = validated;
            break;
        }
      }

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
            createErrorResponse(JSON.stringify(errorMessages), `${target} validation failed`, 400)
          );
        return;
      }

      console.error(`${target} validation error:`, error);
      res
        .status(500)
        .json(
          createErrorResponse('Internal server error during validation', 'Validation error', 500)
        );
    }
  };
};

// Type guard to check if request has validated data
export const hasValidatedData = (req: Request): req is ValidatedRequest => {
  return 'validatedBody' in req || 'validatedQuery' in req || 'validatedParams' in req;
};

// Helper function to extract validation errors in a readable format
export const formatValidationErrors = (error: ZodError): Record<string, string> => {
  const formattedErrors: Record<string, string> = {};

  error.issues.forEach((issue: ZodIssue) => {
    const path = issue.path.join('.');
    formattedErrors[path] = issue.message;
  });

  return formattedErrors;
};

// Helper function to check if error is a Zod validation error
export const isValidationError = (error: any): error is ZodError => {
  return error instanceof ZodError;
};

// Simplified file validation function (without multer dependency)
export const validateFileUpload = (
  file: UploadedFile,
  options: {
    maxSize?: number;
    allowedTypes?: string[];
    requiredFields?: string[];
  } = {}
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const maxSize = options.maxSize || 5 * 1024 * 1024; // 5MB default
  const allowedTypes = options.allowedTypes || ['image/jpeg', 'image/png', 'image/webp'];
  const requiredFields = options.requiredFields || ['originalname', 'mimetype', 'size'];

  // Check required fields
  for (const field of requiredFields) {
    if (!file[field as keyof UploadedFile]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check file size
  if (file.size && file.size > maxSize) {
    errors.push(`File size ${file.size} exceeds maximum allowed size of ${maxSize} bytes`);
  }

  // Check MIME type
  if (file.mimetype && !allowedTypes.includes(file.mimetype)) {
    errors.push(
      `File type ${file.mimetype} is not allowed. Allowed types: ${allowedTypes.join(', ')}`
    );
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Export types and interfaces
export { ValidatedRequest, UploadedFile };
