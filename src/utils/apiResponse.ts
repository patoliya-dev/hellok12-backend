export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  statusCode: number;
}

export const createSuccessResponse = <T>(
  data: T,
  message: string = 'Success',
  statusCode: number = 200
): ApiResponse<T> => ({
  success: true,
  message,
  data,
  statusCode
});

export const createErrorResponse = (
  error: string,
  message: string = 'Error',
  statusCode: number = 400
): ApiResponse => ({
  success: false,
  message,
  error,
  statusCode
});
