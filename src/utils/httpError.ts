export class HttpError extends Error {
  statusCode: number;
  details?: Record<string, any>;

  constructor(message: string, statusCode = 400, details?: Record<string, any>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * IMPORTANT:
 * This function RETURNS `never`
 * So TypeScript KNOWS execution stops here
 */
export function throwHttp(message: string, statusCode = 400, details?: Record<string, any>): never {
  throw new HttpError(message, statusCode, details);
}
