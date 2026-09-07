import type { ErrorRequestHandler, RequestHandler } from "express";

/** Wraps an async route handler so rejected promises reach the error handler. */
export const asyncRoute = (handler: any): RequestHandler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export const errorHandler: ErrorRequestHandler = (error: any, _req, res, _next) => {
  console.error(error);
  if (typeof error?.status === "number" && error.status >= 400 && error.status < 500)
    return res.status(error.status).json({ error: error.message });
  if (error?.code === "P2002") return res.status(409).json({ error: "Email already registered" });
  res.status(500).json({ error: "Internal server error" });
};
