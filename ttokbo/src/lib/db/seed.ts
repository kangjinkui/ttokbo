import type { Db } from "./client";

// 시범운영 전 데모·개발용 데이터. 실제 조직 데이터는 관리자 기능/연동으로 넣는다.
export async function seedIfEmpty(db: Db) {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  if (rows[0].n > 0) return;

  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO departments (id, name) VALUES
      (1, '기획예산과'), (2, '총무과'), (3, '정보화과'), (4, '비서실')`);

    await tx.query(`INSERT INTO users (id, employee_id, name, department_id, role) VALUES
      (1,  'S1001', '김민수', 1, 'staff'),
      (2,  'S1002', '이서연', 1, 'staff'),
      (3,  'S1003', '박지훈', 2, 'staff'),
      (4,  'S1004', '최유진', 2, 'staff'),
      (5,  'S1005', '정하늘', 3, 'staff'),
      (6,  'S1006', '강도윤', 3, 'staff'),
      (11, 'B2001', '한비서', 4, 'secretary'),
      (12, 'B2002', '오비서', 4, 'secretary'),
      (21, 'E3001', '윤국장', 1, 'executive'),
      (31, 'A9001', '시스템관리자', 3, 'admin'),
      (41, 'D0001', '행정국장실 현황판', 4, 'display')`);
    await tx.query(`SELECT setval('users_id_seq', 100)`);

    // 데모에서는 언제든 신청할 수 있도록 운영시간을 넓게 둔다.
    await tx.query(`INSERT INTO rooms (id, name, location, open_from, open_until) VALUES
      (1, '행정국장실', '본관 5층 502호', '00:00', '23:59'),
      (2, '부구청장실', '본관 7층 701호', '00:00', '23:59'),
      (3, '구청장실',   '본관 8층 801호', '00:00', '23:59')`);
    await tx.query(`SELECT setval('rooms_id_seq', 100)`);

    await tx.query(`INSERT INTO room_managers (room_id, user_id) VALUES (1, 11), (1, 31), (2, 12), (3, 12)`);
  });
}
