import { Prisma } from '@prisma/client';
import { Db } from './db';
// Retry whole transactions after serialization failures, never individual writes.
export async function atomic<T>(
  db: Db,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: 'Serializable',
        maxWait: 10000,
        timeout: 20000,
      });
    } catch (error: any) {
      if (attempt < 4 && (error.code === 'P2034' || error.code === 'P2002')) continue;
      throw error;
    }
  }
}
