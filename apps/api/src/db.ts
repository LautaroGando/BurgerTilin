import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.VERCEL === '1'
      ? process.env.TILIN_DATABASE_URL_POOLED || process.env.TILIN_DATABASE_URL
      : process.env.DATABASE_URL;
    super({ adapter: new PrismaPg({ connectionString, max: process.env.VERCEL === '1' ? 2 : 10 }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
