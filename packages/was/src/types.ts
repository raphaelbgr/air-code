import type { Request } from 'express';

export interface JwtPayload {
  userId: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}
