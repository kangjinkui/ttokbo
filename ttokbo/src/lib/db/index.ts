import "server-only";
import { createDb, type Db } from "./client";
import { migrate } from "./migrate";
import { seedIfEmpty } from "./seed";

// Next dev의 HMR이 모듈을 다시 읽어도 DB 연결은 하나만 유지한다.
const globalForDb = globalThis as unknown as { __ttokboDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__ttokboDb) {
    globalForDb.__ttokboDb = (async () => {
      const db = await createDb(process.env.DATABASE_URL);
      await migrate(db);
      if (process.env.SEED_DEMO !== "false") await seedIfEmpty(db);
      return db;
    })();
    // 실패한 연결 시도를 캐시하지 않는다 (다음 요청에서 다시 시도)
    globalForDb.__ttokboDb.catch(() => {
      globalForDb.__ttokboDb = undefined;
    });
  }
  return globalForDb.__ttokboDb;
}

export type { Db, Tx } from "./client";
