import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { RequestHandler, ErrorRequestHandler } from 'express';

const secret = process.env.JWT_SECRET ?? 'replace-with-a-long-random-secret-at-least-16-chars';
export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(header.slice(7), secret) as { sub: string; role: string };
    req.user = { id: payload.sub, role: payload.role as any };
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};
export const requireRole = (...roles: string[]): RequestHandler => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role as string)) return res.status(403).json({ error: 'Forbidden' });
  next();
};
export const validate = (schema: z.ZodType): RequestHandler => (req, res, next) => {
  const parsed = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue?.message ?? 'Validation failed', details: parsed.error.flatten() });
  }
  req.body = (parsed.data as any).body;
  next();
};
export const asyncRoute = (handler: any): RequestHandler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
export const errorHandler: ErrorRequestHandler = (error: any, _req, res, _next) => {
  console.error(error);
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'P2002') return res.status(409).json({ error: 'Email already registered' });
  res.status(500).json({ error: 'Internal server error' });
};
