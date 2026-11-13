import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  Module,
  Controller,
  Get,
  Headers,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Sse,
  Inject,
  BadRequestException,
  UnauthorizedException,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Logger,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { interval, map, merge } from 'rxjs';
import { databaseUrl, Db } from './db';
import { Catalog } from './catalog';
import { Orders, audit } from './orders';
import { Finance } from './finance';
import { Operations } from './operations';
import { Imports } from './imports';
import { AuthGuard, Roles, hash, passwordMatches, passwordHash } from './auth';
import { opening } from './domain';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService, mediaUploadLimit } from './media';
import { MercadoPago } from './mercado-pago';
import { mercadoPagoConfig, onlineMethod, reservedPaymentMethod } from './mercado-pago-client';
import { OrderPush, pushEndpoint } from './order-push';
type AuthRequest = Request & { user: { id: string; role: string; email: string } };
const staff = ['OWNER', 'CASHIER', 'KITCHEN'],
  cash = ['OWNER', 'CASHIER'];
@Catch()
class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : error.code === 'P2025'
            ? 404
            : 500;
    if (status === 500) console.error(error);
    res.status(status).json({
      message:
        status === 413
          ? 'El archivo supera el tamaño permitido'
          : error instanceof ZodError
            ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. ')
            : status === 500
              ? 'No pudimos guardar la operación. Podés reintentar con seguridad.'
              : error.message,
    });
  }
}
@Controller('api')
class Api {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Catalog) private catalog: Catalog,
    @Inject(Orders) private orders: Orders,
    @Inject(Finance) private finance: Finance,
    @Inject(Operations) private ops: Operations,
    @Inject(Imports) private imports: Imports,
    @Inject(MediaService) private media: MediaService,
    @Inject(MercadoPago) private mercadoPago: MercadoPago,
    @Inject(OrderPush) private push: OrderPush,
  ) {}
  @Get('admin/media') @Roles('OWNER') library() {
    return this.media.list();
  }
  @Post('admin/media')
  @Roles('OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: mediaUploadLimit, files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    return this.media.upload(file, req.user.id);
  }
  @Get('media/:filename') async image(
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const content = await this.media.file(filename);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.type('image/webp').send(content);
  }
  @Get('health') async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
  @Post('auth/login') async login(@Body() raw: unknown, @Res({ passthrough: true }) res: Response) {
    const input = z.object({ email: z.email(), password: z.string().min(1).max(200) }).parse(raw);
    const user = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user?.active || !passwordMatches(input.password, user.password))
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    const token = randomBytes(32).toString('hex');
    await this.db.session.create({
      data: { token: hash(token), userId: user.id, expiresAt: new Date(Date.now() + 12 * 3600000) },
    });
    res.cookie('tilin_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 3600000,
      path: '/',
    });
    return { email: user.email, role: user.role, pollOrders: process.env.VERCEL === '1' };
  }
  @Get('auth/me') @Roles(...staff) me(@Req() req: AuthRequest) {
    return { email: req.user.email, role: req.user.role, pollOrders: process.env.VERCEL === '1' };
  }
  @Post('auth/logout') @Roles(...staff) async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const { endpoint } = z.object({ endpoint: pushEndpoint.optional() }).parse(body ?? {});
    await this.db.$transaction(async (tx) => {
      if (endpoint) await tx.pushDevice.deleteMany({ where: { endpoint, userId: req.user.id } });
      await tx.session.deleteMany({ where: { token: hash(req.cookies.tilin_session) } });
    });
    res.clearCookie('tilin_session', { path: '/' });
    return { ok: true };
  }
  @Get('admin/push/key') @Roles(...staff) pushKey() {
    return this.push.publicKey();
  }
  @Post('admin/push/device') @Roles(...staff) registerPush(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.push.save(req.user.id, body);
  }
  @Post('admin/push/status') @Roles(...staff) async pushStatus(@Req() req: AuthRequest, @Body() body: unknown) {
    const { endpoint } = z.object({ endpoint: pushEndpoint }).parse(body);
    const device = await this.db.pushDevice.findFirst({ where: { endpoint, userId: req.user.id }, select: { endpoint: true } });
    return { enabled: Boolean(device) };
  }
  @Post('admin/push/remove') @Roles(...staff) removePush(@Req() req: AuthRequest, @Body() body: unknown) {
    const { endpoint } = z.object({ endpoint: pushEndpoint }).parse(body);
    return this.push.remove(req.user.id, endpoint);
  }
  @Post('admin/push/test') @Roles(...staff) testPush(@Req() req: AuthRequest, @Body() body: unknown) {
    const { endpoint } = z.object({ endpoint: pushEndpoint }).parse(body);
    return this.push.test(req.user.id, endpoint);
  }
  @Get('catalog') async publicCatalog() {
    const settings = await this.catalog.settings();
    return {
      products: await this.catalog.list({ publicView: true }),
      settings: {
        delay: settings.delay,
        whatsapp: settings.whatsapp,
        pickupAddress: settings.pickupAddress,
        zones: settings.zones.filter((z) => z.enabled),
        methods: [
          ...settings.methods.filter(
            (m) => m.enabled && !m.receivable && !reservedPaymentMethod(m),
          ),
          ...(mercadoPagoConfig() ? [onlineMethod] : []),
        ].map(({ id, name }) => ({ id, name })),
      },
      opening: opening(settings),
    };
  }
  @Post('orders') async create(@Body() body: unknown) {
    const order = await this.orders.create(body);
    if ((body as { method?: string }).method !== onlineMethod.id) return order;
    const checkout = await this.mercadoPago.start(order.tracking).catch((error: unknown) => {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      Logger.warn(
        `No se pudo abrir Mercado Pago para el pedido #${order.number} (HTTP ${status})`,
        'Checkout',
      );
      return { checkoutUrl: null };
    });
    return { ...order, ...checkout };
  }
  @Post('tracking/:token/mercado-pago') checkout(@Param('token') token: string) {
    return this.mercadoPago.start(token);
  }
  @Post('tracking/:token/mercado-pago/verificar') refreshPayment(@Param('token') token: string) {
    return this.mercadoPago.refresh(token);
  }
  @Post('webhooks/mercado-pago') paymentWebhook(
    @Query('data.id') id: string,
    @Headers('x-request-id') requestId: string,
    @Headers('x-signature') signature: string,
  ) {
    return this.mercadoPago.webhook(id ?? '', requestId ?? '', signature ?? '');
  }
  @Get('cron/mercado-pago') async paymentReconciliation(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      !auth ||
      !timingSafeEqual(Buffer.from(hash(auth)), Buffer.from(hash(`Bearer ${secret}`)))
    ) {
      throw new UnauthorizedException();
    }
    await Promise.all([
      this.push.deliver(),
      mercadoPagoConfig() && this.mercadoPago.reconcilePending(),
    ]);
    return { ok: true };
  }
  @Get('tracking/:token') track(@Param('token') token: string) {
    return this.orders.tracking(token);
  }
  @Get('admin/orders') @Roles(...staff) active(@Req() req: AuthRequest) {
    return this.orders.active(req.user.role === 'KITCHEN');
  }
  @Post('admin/orders') @Roles(...cash) manual(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.orders.create(body, req.user.id);
  }
  @Patch('admin/orders/:id/status') @Roles(...staff) status(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const { status } = z
      .object({
        status: z.enum([
          'ACCEPTED',
          'PREPARING',
          'READY',
          'DISPATCHED',
          'DELIVERED',
          'REJECTED',
          'CANCELLED',
        ]),
      })
      .parse(body);
    if (req.user.role === 'KITCHEN' && !['ACCEPTED', 'PREPARING', 'READY'].includes(status))
      throw new BadRequestException('Acción reservada a caja');
    return this.orders.change(id, status, req.user.id);
  }
  @Post('admin/orders/:id/ack') @Roles(...staff) ack(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.orders.acknowledge(id, req.user.id);
  }
  @Sse('admin/events') @Roles(...staff) events() {
    return merge(
      this.orders.events,
      interval(15000).pipe(map(() => ({ data: JSON.stringify({ heartbeat: true }) }))),
    );
  }
  @Get('admin/products') @Roles(...staff) products(@Req() req: AuthRequest) {
    return this.catalog.list({ publicView: false, includeCosts: req.user.role === 'OWNER' });
  }
  @Get('admin/products/archived') @Roles('OWNER') archivedProducts() {
    return this.catalog.list({ publicView: false, archived: true, includeCosts: true });
  }
  @Patch('admin/products/:id/archive') @Roles('OWNER') archiveProduct(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.archiveProduct(
      id,
      z.object({ archived: z.boolean() }).parse(b).archived,
      r.user.id,
    );
  }
  @Post('admin/products') @Roles('OWNER') product(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.product(undefined, b, r.user.id);
  }
  @Patch('admin/products/:id') @Roles('OWNER') editProduct(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.product(id, b, r.user.id);
  }
  @Patch('admin/products/:id/availability') @Roles(...staff) availability(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.soldOut(id, b, r.user.id);
  }
  @Post('admin/prices') @Roles('OWNER') prices(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.prices(b, r.user.id);
  }
  @Get('admin/settings') @Roles(...cash) async settings() {
    return { ...(await this.catalog.settings()), mercadoPagoAvailable: !!mercadoPagoConfig() };
  }
  @Get('admin/operation') @Roles(...staff) async operation() {
    const s = await this.catalog.settings();
    return { paused: s.paused, delay: s.delay };
  }
  @Patch('admin/settings') @Roles('OWNER') saveSettings(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.settings(b, r.user.id);
  }
  @Patch('admin/operation') @Roles(...staff) quick(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.quick(b, r.user.id);
  }
  @Get('admin/inventory') @Roles(...cash) inventory() {
    return this.ops.inventory();
  }
  @Get('admin/inventory/archived') @Roles('OWNER') archivedIngredients() {
    return this.ops.inventory(true);
  }
  @Patch('admin/ingredients/:id/archive') @Roles('OWNER') archiveIngredient(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.archiveIngredient(
      id,
      z.object({ archived: z.boolean() }).parse(b).archived,
      r.user.id,
    );
  }
  @Post('admin/ingredients') @Roles('OWNER') ingredient(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.ingredient(b, r.user.id);
  }
  @Patch('admin/ingredients/:id') @Roles('OWNER') editIngredient(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.ingredient(b, r.user.id, id);
  }
  @Post('admin/ingredients/:id/movements') @Roles(...cash) stock(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.stock(id, b, r.user.id);
  }
  @Post('admin/orders/:id/payments') @Roles(...cash) pay(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.finance.pay(id, b, r.user.id);
  }
  @Post('admin/payments/:id/verify') @Roles(...cash) verify(
    @Param('id') id: string,
    @Req() r: AuthRequest,
  ) {
    return this.finance.verify(id, r.user.id);
  }
  @Post('admin/orders/:id/refund') @Roles(...cash) refund(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.finance.refund(id, b, r.user.id);
  }
  @Get('admin/shift') @Roles(...cash) async shift(@Res() res: Response) {
    res.json(await this.finance.shift());
  }
  @Get('admin/receivables') @Roles(...cash) receivables() {
    return this.finance.receivables();
  }
  @Post('admin/settlements') @Roles(...cash) settle(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.finance.settle(b, r.user.id);
  }
  @Post('admin/shift/open') @Roles(...cash) open(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.finance.open(b, r.user.id);
  }
  @Post('admin/shift/close') @Roles(...cash) close(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.finance.close(b, r.user.id);
  }
  @Post('admin/shift/entries') @Roles(...cash) entry(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.finance.entry(b, r.user.id);
  }
  @Get('admin/sales') @Roles(...cash) sales(@Query() q: unknown) {
    return this.finance.sales(q);
  }
  @Patch('admin/sales/:id/archive') @Roles('OWNER') archiveSale(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.finance.archiveSale(
      id,
      z.object({ archived: z.boolean() }).parse(b).archived,
      r.user.id,
    );
  }
  @Get('admin/performance') @Roles(...cash) performance(@Query() q: unknown) {
    return this.finance.performance(q);
  }
  @Get('admin/sales.csv') @Roles(...cash) async csv(@Query() q: unknown, @Res() res: Response) {
    res.setHeader('Content-Disposition', 'attachment; filename="ventas-burger-tilin.csv"');
    res.type('text/csv; charset=utf-8').send(await this.finance.csv(q));
  }
  @Get('admin/customers') @Roles(...cash) customers() {
    return this.db.customer.findMany({
      select: { id: true, name: true, phone: true, _count: { select: { orders: true } } },
      take: 200,
      orderBy: { name: 'asc' },
    });
  }
  @Get('admin/customers/:id') @Roles(...cash) customer(@Param('id') id: string) {
    return this.ops.customerHistory(id);
  }
  @Post('admin/import') @Roles(...cash) importOrders(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.imports.run(b, r.user.id);
  }
  @Get('admin/orders/:id/repeat') @Roles(...cash) repeat(@Param('id') id: string) {
    return this.imports.repeat(id);
  }
  @Post('admin/users') @Roles('OWNER') user(@Body() b: unknown, @Req() r: AuthRequest) {
    return this.ops.user(b, r.user.id);
  }
  @Get('admin/audit') @Roles('OWNER') audit() {
    return this.db.audit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Get('admin/users') @Roles('OWNER') users() {
    return this.db.user.findMany({
      select: { id: true, email: true, role: true, active: true },
      orderBy: { email: 'asc' },
    });
  }
  @Patch('admin/users/:id') @Roles('OWNER') access(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.ops.access(id, b, r.user.id);
  }
  @Post('auth/password') @Roles(...staff) async password(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const input = z
      .object({ current: z.string().max(200), password: z.string().min(12).max(200) })
      .parse(raw);
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: r.user.id } });
      if (!passwordMatches(input.current, user.password))
        throw new BadRequestException('La contraseña actual no coincide');
      await tx.user.update({
        where: { id: user.id },
        data: { password: passwordHash(input.password) },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.pushDevice.deleteMany({ where: { userId: user.id } });
      await audit(tx, user.id, 'CHANGE_PASSWORD', user.id, {});
    });
    return { ok: true };
  }
  @Patch('admin/orders/:id/rider') @Roles(...cash) async rider(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    const input = z.object({ rider: z.string().max(100) }).parse(b);
    await this.db.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: input });
      await audit(tx, r.user.id, 'RIDER', id, input);
    });
    return { ok: true };
  }
}
@Module({
  controllers: [Api],
  providers: [
    Db,
    Catalog,
    Orders,
    Finance,
    Operations,
    Imports,
    MediaService,
    MercadoPago,
    OrderPush,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
class App {}
async function createApp() {
  const hosted = process.env.VERCEL === '1';
  const databaseReady = Boolean(databaseUrl());
  if (!hosted && !databaseReady) throw new Error('Falta DATABASE_URL');
  const app = await NestFactory.create<NestExpressApplication>(App, {
    logger: ['error', 'warn', 'log'],
  });
  app.useBodyParser('json', { limit: '512kb' });
  app.use(helmet());
  app.use(cookieParser());
  const attempts = new Map<string, { count: number; until: number }>();
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!databaseReady) {
      res
        .status(503)
        .json({ message: 'Esta versión todavía no tiene una base de datos conectada.' });
      return;
    }
    const origins = new Set([
      process.env.WEB_ORIGIN || 'http://localhost:3000',
      ...(process.env.NODE_ENV !== 'production' ? ['http://127.0.0.1:3000'] : []),
      ...(hosted
        ? [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
            .filter(Boolean)
            .map((h) => `https://${h}`)
        : []),
    ]);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      !origins.has(req.headers.origin)
    ) {
      res.status(403).json({ message: 'Origen no permitido' });
      return;
    }
    const checkout = /^\/api\/tracking\/[^/]+\/mercado-pago(?:\/verificar)?$/.test(req.path);
    if (
      req.method === 'POST' &&
      (checkout || ['/api/auth/login', '/api/orders'].includes(req.path))
    ) {
      const forwarded =
        hosted || process.env.TRUST_PROXY === 'true'
          ? String(req.headers[hosted ? 'x-vercel-forwarded-for' : 'x-forwarded-for'] || '')
              .split(',')[0]
              .trim()
          : '';
      const k = `${forwarded || req.socket.remoteAddress}:${checkout ? 'mp-checkout' : req.path}`;
      const now = Date.now();
      if (attempts.size > 10000)
        for (const [key, v] of attempts) if (v.until < now) attempts.delete(key);
      let a = attempts.get(k);
      if (!a || a.until < now) {
        a = { count: 0, until: now + 60000 };
        attempts.set(k, a);
      }
      if (++a.count > (req.path.includes('login') ? 20 : 120)) {
        res.status(429).json({ message: 'Esperá un minuto y volvé a intentar' });
        return;
      }
    }
    next();
  });
  app.useGlobalFilters(new Errors());
  return app;
}

export async function bootstrap(port = Number(process.env.PORT || 4000)) {
  const app = await createApp();
  await app.listen(port, process.env.API_HOST || '127.0.0.1');
  return app;
}

let vercelApp: Promise<NestExpressApplication> | undefined;
export default async function handler(req: Request, res: Response) {
  vercelApp ??= createApp()
    .then((app) => app.init())
    .catch((error) => {
      vercelApp = undefined;
      throw error;
    });
  const app = await vercelApp;
  app.getHttpAdapter().getInstance()(req, res);
}

if (process.env.VERCEL !== '1' && require.main === module) bootstrap();
