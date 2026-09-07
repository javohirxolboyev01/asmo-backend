import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { config } from "../config.js";

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as {
      sub: string;
      role: string;
    };
    req.user = { id: payload.sub, role: payload.role as any };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role as string))
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
