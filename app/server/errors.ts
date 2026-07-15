import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { redactSecrets } from "./redact";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(code: string, message: string, details?: unknown): AppError {
  return new AppError(400, code, message, details);
}

export function notFoundError(code: string, message: string, details?: unknown): AppError {
  return new AppError(404, code, message, details);
}

export function conflictError(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError(400, "VALIDATION_ERROR", "Request validation failed.", error.issues);
  }

  if (error instanceof SyntaxError && "body" in error) {
    return new AppError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }

  if (error instanceof Error) {
    return new AppError(500, "INTERNAL_ERROR", error.message);
  }

  return new AppError(500, "INTERNAL_ERROR", "An unknown error occurred.");
}

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  const normalized = normalizeError(error);
  const body: Record<string, unknown> = {
    error: {
      code: normalized.code,
      message: normalized.message
    }
  };

  if (normalized.details !== undefined) {
    body.error = {
      ...(body.error as Record<string, unknown>),
      details: redactSecrets(normalized.details)
    };
  }

  res.status(normalized.status).json(body);
};
