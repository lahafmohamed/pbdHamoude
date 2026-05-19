import { Response as ExpressResponse } from 'express';

/**
 * Standard API response envelope
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Success response helper
 */
export function successResponse<T>(
  data: T,
  message?: string,
  pagination?: ApiResponse['pagination']
): ApiResponse<T>;
export function successResponse<T>(
  res: ExpressResponse,
  data: T,
  message?: string,
  pagination?: ApiResponse['pagination']
): void;
export function successResponse<T>(
  arg1: ExpressResponse | T,
  arg2?: T | string,
  arg3?: string | ApiResponse['pagination'],
  arg4?: ApiResponse['pagination']
): ApiResponse<T> | void {
  // Legacy/controller style: successResponse(res, data, message?, pagination?)
  if (typeof (arg1 as any)?.json === 'function') {
    const res = arg1 as ExpressResponse;
    const data = arg2 as T;
    const message = typeof arg3 === 'string' ? arg3 : undefined;
    const pagination = (typeof arg3 === 'object' ? arg3 : arg4) as ApiResponse['pagination'] | undefined;

    res.json({
      success: true,
      data,
      message,
      pagination,
    });
    return;
  }

  // Functional style: successResponse(data, message?, pagination?)
  return {
    success: true,
    data: arg1 as T,
    message: typeof arg2 === 'string' ? arg2 : undefined,
    pagination: (typeof arg2 === 'object' ? arg2 : arg3) as ApiResponse['pagination'] | undefined,
  };
}

/**
 * Error response helper
 */
export const errorResponse = (
  error: string,
  statusCode: number = 400
): { statusCode: number; body: ApiResponse } => ({
  statusCode,
  body: {
    success: false,
    error,
  },
});

/**
 * Paginated response helper
 * Sends a standardized paginated response with metadata
 */
export const paginatedResponse = <T>(
  res: ExpressResponse,
  data: T,
  total: number,
  page: number,
  limit: number,
  message?: string
): void => {
  const totalPages = Math.ceil(total / limit);

  res.json({
    success: true,
    data,
    message,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  });
};
