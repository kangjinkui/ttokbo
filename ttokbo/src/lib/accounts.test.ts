import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminUpdateUser, changePhone, sendLoginCode, signUp, toE164, verifyLoginCode } from "./accounts";
import { createDb, type Db } from "./db/client";
import { migrate } from "./db/migrate";
import { seedIfEmpty } from "./db/seed";
import type { MessagingProvider, OutboundMessage } from "./messaging/provider";
import * as q from "./queue/service";

let db: Db;
let sent: OutboundMessage[];
const provider: MessagingProvider = { name: "t", send: async (m) => (sent.push(m), { status: "sent", providerMessageId: `m${sent.length}` }) };
const hash = (s: string) => `h:${s}`;
const PHONE = "+821055556666";
const lastCode = () => sent.at(-1)!.sms.text.match(/\d{6}/)![0];

beforeEach(async () => {
  db = await createDb("memory");
  await migrate(db);
  await seedIfEmpty(db);
  sent = [];
});
afterEach(async () => db.close());

async function login(phone = PHONE) {
  await sendLoginCode(db, provider, phone, hash);
  return verifyLoginCode(db, phone, lastCode(), hash);
}

describe("휴대폰 문자 인증", () => {
  it("번호 형식을 통일한다", () => {
    expect(toE164("010-5555-6666")).toBe(PHONE);
    expect(toE164("02-123-4567")).toBeNull();
  });

  it("인증번호를 문자로 보내고, 처음 보는 번호는 가입 단계로 보낸다", async () => {
    expect(await login()).toBeNull();
    expect(sent[0].to).toBe(PHONE);
    expect(sent[0].stage).toBe("account");
  });

  it("같은 인증번호는 한 번만 쓸 수 있다", async () => {
    await login();
    await expect(verifyLoginCode(db, PHONE, lastCode(), hash)).rejects.toMatchObject({ code: "CODE_EXPIRED" });
  });

  it("30초 안에는 다시 보내지 않는다", async () => {
    await sendLoginCode(db, provider, PHONE, hash);
    await expect(sendLoginCode(db, provider, PHONE, hash)).rejects.toMatchObject({ code: "TOO_SOON" });
  });

  it("5번 틀리면 그 인증번호는 더 이상 받지 않는다", async () => {
    await sendLoginCode(db, provider, PHONE, hash);
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(verifyLoginCode(db, PHONE, wrong, hash)).rejects.toMatchObject({ code: "WRONG_CODE" });
    await expect(verifyLoginCode(db, PHONE, lastCode(), hash)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("문자 발송에 실패하면 바로 다시 요청할 수 있다", async () => {
    const broken: MessagingProvider = { name: "x", send: async () => { throw new Error("down"); } };
    await expect(sendLoginCode(db, broken, PHONE, hash)).rejects.toMatchObject({ code: "SMS_FAILED" });
    await sendLoginCode(db, provider, PHONE, hash);
  });
});

describe("가입과 승인", () => {
  it("가입하면 승인 전 상태이고, 같은 번호로 다시 로그인된다", async () => {
    const user = await signUp(db, { phone: PHONE, name: " 홍길동 ", departmentId: 101, consent: true });
    expect(user).toMatchObject({ role: "staff", approved: false });
    expect(await login()).toMatchObject({ id: user.id, approved: false, active: true });
  });

  it("ADMIN_PHONES 번호는 바로 승인된 관리자가 된다", async () => {
    const user = await signUp(db, { phone: PHONE, name: "관리자", departmentId: 1, consent: true }, { ADMIN_PHONES: "010-5555-6666" });
    expect(user).toMatchObject({ role: "admin", approved: true });
  });

  it("동의 없이, 없는 소속으로, 이미 쓰는 번호로는 가입할 수 없다", async () => {
    await expect(signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: false })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(signUp(db, { phone: PHONE, name: "홍길동", departmentId: 9999, consent: true })).rejects.toMatchObject({ code: "INVALID_DEPARTMENT" });
    await signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: true });
    await expect(signUp(db, { phone: PHONE, name: "다른사람", departmentId: 101, consent: true })).rejects.toMatchObject({ code: "PHONE_TAKEN" });
  });

  it("승인 전에는 줄을 설 수 없고, 승인하면 안내 문자가 간다", async () => {
    const user = await signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: true });
    expect((await q.findStaff(db, { id: 11, role: "secretary" }, "홍")).length).toBe(0);
    await adminUpdateUser(db, provider, 31, user.id, { action: "approve" }, "https://example.test");
    expect(sent.at(-1)).toMatchObject({ to: PHONE, stage: "account" });
    expect(sent.at(-1)!.sms.text).toContain("https://example.test");
    expect((await q.findStaff(db, { id: 11, role: "secretary" }, "홍")).length).toBe(1);
  });

  it("거절하면 계정을 지워 같은 번호로 다시 가입할 수 있다", async () => {
    const user = await signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: true });
    await adminUpdateUser(db, provider, 31, user.id, { action: "reject" });
    expect(await login()).toBeNull();
  });

  it("비서로 지정하면 담당 보고실을 바꾸고, 자기 계정은 바꿀 수 없다", async () => {
    const user = await signUp(db, { phone: PHONE, name: "새비서", departmentId: 1, consent: true });
    await adminUpdateUser(db, provider, 31, user.id, { action: "setRole", role: "secretary", roomIds: [4, 8] });
    const { rows } = await db.query<{ room_id: number }>(`SELECT room_id FROM room_managers WHERE user_id = $1 ORDER BY room_id`, [user.id]);
    expect(rows.map((r) => r.room_id)).toEqual([4, 8]);
    await expect(adminUpdateUser(db, provider, 31, 31, { action: "block" })).rejects.toMatchObject({ code: "SELF_CHANGE" });
  });

  it("차단된 계정은 로그인 결과에 비활성으로 나온다", async () => {
    const user = await signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: true });
    await adminUpdateUser(db, provider, 31, user.id, { action: "block" });
    expect(await login()).toMatchObject({ id: user.id, active: false });
  });

  it("다른 계정이 쓰는 번호로는 바꿀 수 없다", async () => {
    await signUp(db, { phone: PHONE, name: "홍길동", departmentId: 101, consent: true });
    await expect(changePhone(db, 1, PHONE)).rejects.toMatchObject({ code: "PHONE_TAKEN" });
    await changePhone(db, 1, "+821077778888");
  });
});
