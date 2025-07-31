import { Request } from "express";

/**
 * Get production-safe cookie configuration for AWS deployment
 * @param req - Express Request object to get host information
 * @returns Cookie configuration object
 */
export function getCookieConfig(req: Request) {
  const host = req.headers.host || "";
  const isProduction =
    process.env.NODE_ENV === "production" ||
    host.includes(".amazonaws.com") ||
    host.includes(".vercel.app") ||
    host.includes(".netlify.app") ||
    host.includes(".railway.app") ||
    host.includes(".render.com");

  // Determine domain for cookies
  let domain = undefined;
  if (isProduction && host && !host.includes("localhost")) {
    domain = host;
  }

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    domain: domain,
  };
}

/**
 * Get cookie configuration for clearing cookies (logout)
 * @param req - Express Request object to get host information
 * @returns Cookie configuration object for clearing
 */
export function getClearCookieConfig(req: Request) {
  const config = getCookieConfig(req);
  return {
    ...config,
    maxAge: 0, // Expire immediately
  };
}
