export interface AuthUser {
  id: string;
  email?: string;
  emailVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Propagated from a valid X-Request-Id header or generated per request. */
      requestId: string;
      /** Set only by the auth middleware, from a server-verified Supabase token. Never from body/query. */
      user?: AuthUser;
    }
  }
}

export {};
