import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Db } from './db';
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(s: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(s, salt, 64).toString('hex')}`;
}
export function passwordMatches(s: string, stored: string) {
  const [salt, key] = stored.split(':');
  const derived = scryptSync(s, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.tilin_session;
    if (!token) throw new UnauthorizedException('Ingresá para continuar');
    const session = await this.db.session.findUnique({
      where: { token: hash(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active)
      throw new UnauthorizedException('Tu sesión venció');
    if (!roles.includes(session.user.role))
      throw new ForbiddenException('Tu perfil no tiene permiso para esta acción');
    req.user = session.user;
    return true;
  }
}
