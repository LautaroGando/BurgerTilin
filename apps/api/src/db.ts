import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function databaseUrl() {
  if (process.env.VERCEL !== '1') return process.env.DATABASE_URL;
  return (
    process.env.TILIN_DATABASE_URL_POOLED ||
    process.env.TILIN_DATABASE_URL ||
    process.env.DATABASE_URL_POOLED ||
    process.env.DATABASE_URL
  );
}

@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: databaseUrl(),
        max: process.env.VERCEL === '1' ? 2 : 10,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
