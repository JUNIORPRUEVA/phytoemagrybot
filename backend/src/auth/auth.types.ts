import { UserRole } from '@prisma/client';

export interface AuthTokenPayload {
  userId: string;
  role: UserRole;
  email: string;
  /** The company this token is scoped to. Required for all tenant operations. */
  activeCompanyId: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}