import type { Db } from "./client";

// 강남구청 조직도 (국 → 과). 국 id는 1부터, 과 id는 101부터 순서대로 붙인다.
const ORG: { name: string; teams: string[] }[] = [
  { name: "행정국", teams: ["총무과", "주민자치과", "교육지원과", "재무과", "민원여권과"] },
  { name: "기획경제국", teams: ["기획예산과", "지역경제과", "일자리정책과", "세무관리과", "재산세과", "지방소득세과"] },
  { name: "복지생활국", teams: ["복지정책과", "사회보장과", "어르신복지과", "장애인복지과", "보육지원과", "가족정책과", "자원순환과"] },
  { name: "미래문화국", teams: ["디지털도시과", "스마트정보과", "문화도시과", "생활체육과", "관광진흥과"] },
  { name: "도시환경국", teams: ["주택과", "재건축사업과", "도시계획과", "건축과", "환경과", "공원녹지과", "부동산정보과"] },
  { name: "안전교통국", teams: ["재난안전과", "교통행정과", "주차관리과", "자동차민원과", "건설관리과", "도로관리과", "치수과"] },
  { name: "미래전략기획단", teams: ["혁신전략과", "공간개발과"] },
];

// 보고실. 위치는 아직 받지 못해 비워 둔다(관리자 화면에서 입력).
const ROOMS = [
  "행정국장실", "부구청장실", "구청장실",
  "기획경제국장실", "복지생활국장실", "미래문화국장실", "도시환경국장실", "안전교통국장실", "미래전략기획단장실",
];

// 비서 1명이 보고실 여러 곳을 맡을 수 있다. 실제 비서는 가입 후 관리자가 지정하고, 여기 계정은 시험용이다.
const SECRETARIES: { id: number; name: string; rooms: string[] }[] = [
  { id: 11, name: "행정국 비서", rooms: ["행정국장실"] },
  { id: 12, name: "부구청장실 비서", rooms: ["부구청장실"] },
  { id: 13, name: "구청장실 비서", rooms: ["구청장실"] },
  { id: 14, name: "기획경제·안전교통 비서", rooms: ["기획경제국장실", "안전교통국장실"] },
  { id: 15, name: "복지생활·도시환경 비서", rooms: ["복지생활국장실", "도시환경국장실"] },
  { id: 16, name: "미래문화·미래전략 비서", rooms: ["미래문화국장실", "미래전략기획단장실"] },
];

// 가입 기능 전까지 쓰는 시험용 직원 계정
const TEST_STAFF: { id: number; name: string; team: string }[] = [
  { id: 1, name: "김민수", team: "기획예산과" },
  { id: 2, name: "이서연", team: "기획예산과" },
  { id: 3, name: "박지훈", team: "총무과" },
  { id: 4, name: "최유진", team: "총무과" },
  { id: 5, name: "정하늘", team: "스마트정보과" },
  { id: 6, name: "강도윤", team: "디지털도시과" },
];

export async function seedIfEmpty(db: Db) {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  if (rows[0].n > 0) return;

  await db.transaction(async (tx) => {
    const deptId = new Map<string, number>();
    let teamId = 101;
    for (const [i, bureau] of ORG.entries()) {
      await tx.query(`INSERT INTO departments (id, name) VALUES ($1, $2)`, [i + 1, bureau.name]);
      deptId.set(bureau.name, i + 1);
      for (const team of bureau.teams) {
        await tx.query(`INSERT INTO departments (id, name, parent_id) VALUES ($1, $2, $3)`, [teamId, team, i + 1]);
        deptId.set(team, teamId++);
      }
    }
    await tx.query(`SELECT setval('departments_id_seq', 1000)`);

    const user = (id: number, employeeId: string, name: string, dept: string | null, role: string) =>
      tx.query(`INSERT INTO users (id, employee_id, name, department_id, role) VALUES ($1, $2, $3, $4, $5)`,
        [id, employeeId, name, dept ? deptId.get(dept) : null, role]);
    for (const s of TEST_STAFF) await user(s.id, `S${1000 + s.id}`, s.name, s.team, "staff");
    for (const s of SECRETARIES) await user(s.id, `B${2000 + s.id}`, s.name, null, "secretary");
    await user(21, "E3001", "윤국장", "기획경제국", "executive");
    await user(31, "A9001", "시스템관리자", null, "admin");
    await user(41, "D0001", "행정국장실 현황판", null, "display");
    await tx.query(`SELECT setval('users_id_seq', 100)`);

    // 시범 기간에는 언제든 신청할 수 있도록 운영시간을 넓게 둔다.
    const roomId = new Map<string, number>();
    for (const [i, name] of ROOMS.entries()) {
      await tx.query(`INSERT INTO rooms (id, name, open_from, open_until) VALUES ($1, $2, '00:00', '23:59')`, [i + 1, name]);
      roomId.set(name, i + 1);
    }
    await tx.query(`SELECT setval('rooms_id_seq', 100)`);

    for (const s of SECRETARIES) {
      for (const room of s.rooms) {
        await tx.query(`INSERT INTO room_managers (room_id, user_id) VALUES ($1, $2)`, [roomId.get(room), s.id]);
      }
    }
  });
}
