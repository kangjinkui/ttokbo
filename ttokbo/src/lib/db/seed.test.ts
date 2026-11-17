import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client";
import { migrate } from "./migrate";
import { seedIfEmpty, seedOrgIfEmpty } from "./seed";

let db: Db;
beforeEach(async () => {
  db = await createDb("memory");
  await migrate(db);
});
afterEach(async () => db.close());

const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe("시드", () => {
  it("운영용 시드는 조직도·보고실만 넣고 시험 계정은 넣지 않는다", async () => {
    await seedOrgIfEmpty(db);
    expect(await count("departments")).toBe(46);
    expect(await count("rooms")).toBe(10);
    expect(await count("users")).toBe(0);
  });

  it("다시 실행해도 중복으로 넣지 않는다", async () => {
    await seedIfEmpty(db);
    await seedIfEmpty(db);
    expect(await count("departments")).toBe(46);
    expect(await count("room_managers")).toBe(9);
  });
});
