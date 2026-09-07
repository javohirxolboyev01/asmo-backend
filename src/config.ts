// src/config.ts — centralised, typed access to environment configuration.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret:
    process.env.JWT_SECRET ?? "replace-with-a-long-random-secret-at-least-16-chars",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  refreshTokenExpiresDays: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? 30),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim()),
};
