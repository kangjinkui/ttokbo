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

describe("보고실 표시 순서", () => {
  const ORDER = ["구청장실", "부구청장실", "행정국장실", "기획경제국장실", "복지생활국장실", "미래문화국장실",
    "도시환경국장실", "안전교통국장실", "미래전략기획단장실", "정책보좌관실"];

  it("새로 설치하면 정해진 순서로 보인다 (id는 그대로)", async () => {
    await seedIfEmpty(db);
    const { deskRooms } = await import("../queue/service");
    expect((await deskRooms(db, { id: 31, role: "admin" })).map((r) => r.name)).toEqual(ORDER);
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM rooms WHERE name = '행정국장실'`);
    expect(rows[0].id).toBe(1);
  });

  it("기존 DB는 마이그레이션이 순서와 이름(보좌관실 → 정책보좌관실)을 맞춘다", async () => {
    const old = await createDb("memory");
    // 0007 이전 상태를 흉내: 마이그레이션을 0006까지만 적용한 것처럼 sort_order 없이 만든 뒤 다시 적용
    await migrate(old);
    await old.query(`ALTER TABLE rooms DROP COLUMN sort_order`);
    await old.query(`DELETE FROM schema_migrations WHERE id = '0007_room_order'`);
    for (const [i, name] of ["행정국장실", "부구청장실", "구청장실", "기획경제국장실", "복지생활국장실", "미래문화국장실",
      "도시환경국장실", "안전교통국장실", "미래전략기획단장실", "보좌관실"].entries()) {
      await old.query(`INSERT INTO rooms (id, name) VALUES ($1, $2)`, [i + 1, name]);
    }
    await migrate(old);
    const { rows } = await old.query<{ name: string }>(`SELECT name FROM rooms ORDER BY sort_order, id`);
    expect(rows.map((r) => r.name)).toEqual(ORDER);
    await old.close();
  });
});
