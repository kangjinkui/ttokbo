// PGlite(개발·테스트)와 PostgreSQL(운영) 위에 같은 SQL을 돌리기 위한 얇은 래퍼.
// 둘 다 query(sql, params) → { rows } 형태라 서비스 코드는 구현체를 모른다.

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * url 규칙
 * - postgres:// 또는 postgresql:// → node-postgres 풀
 * - "memory" → 메모리 PGlite (테스트)
 * - 그 외/미지정 → 파일 PGlite (기본 ./.data/pglite)
 */
export async function createDb(url?: string): Promise<Db> {
  if (url && /^postgres(ql)?:\/\//.test(url)) return createPgDb(url);

  const { PGlite } = await import("@electric-sql/pglite");
  let pg;
  if (url === "memory") {
    pg = new PGlite();
  } else {
    const dir = url || "./.data/pglite";
    // PGlite는 상위 폴더를 만들지 않는다
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    pg = new PGlite(dir);
  }
  await pg.waitReady;
  await pg.exec("SET TIME ZONE 'Asia/Seoul'");
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    transaction: (fn) => pg.transaction((tx) => fn({ query: (s, p) => tx.query(s, p) as never })),
    close: () => pg.close(),
  };
}

async function createPgDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, options: "-c timezone=Asia/Seoul" });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (s, p) => client.query(s, p as unknown[]) as never });
        await client.query("COMMIT");
        client.release();
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // 연결이 끊긴 경우: 원래 오류를 살리고 이 연결은 풀에서 버린다
          client.release(true);
          throw err;
        }
        client.release();
        throw err;
      }
    },
    close: () => pool.end(),
  };
}
