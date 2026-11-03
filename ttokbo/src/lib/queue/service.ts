import { createHash, randomBytes } from "node:crypto";
import type { Db, Tx } from "../db/client";
import { estimateNewJoiner, estimateQueue, type CurrentReport } from "./estimate";
import { enqueue, messages, type MessageBase } from "./notify";
import {
  Effects,
  EXPECTED_MINUTES,
  MAX_DEFER_STEPS,
  MAX_DEFERS,
  QueueError,
  type Actor,
  type CallResponse,
  type RequestStatus,
  type RoomStatus,
} from "./types";

// ─── 내부 모델 ────────────────────────────────────────────────────────────

interface RoomRow {
  id: number;
  name: string;
  location: string;
  status: RoomStatus;
  accepts_when_paused: boolean;
  grace_minutes: number;
  transition_minutes: number;
  is_open_hours: boolean;
}

interface RequestRow {
  id: number;
  room_id: number;
  user_id: number;
  ticket_no: number;
  title: string | null;
  expected_minutes: number;
  status: RequestStatus;
  priority: "normal" | "urgent";
  urgent_reason: string | null;
  position: number | null;
  defer_count: number;
  call_count: number;
  called_at: Date | null;
  call_expires_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

const ROOM_COLS = `id, name, location, status, accepts_when_paused, grace_minutes, transition_minutes,
  (now() AT TIME ZONE 'Asia/Seoul')::time BETWEEN open_from AND open_until AS is_open_hours`;

const baseUrl = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

async function lockRoom(tx: Tx, roomId: number): Promise<RoomRow> {
  const { rows } = await tx.query<RoomRow>(`SELECT ${ROOM_COLS} FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
  if (!rows[0]) throw new QueueError("ROOM_NOT_FOUND", "보고실을 찾을 수 없습니다.", 404);
  return rows[0];
}

/** 요청이 속한 보고실을 먼저 잠그고 요청을 다시 읽는다 (동시 조작 시 순서 충돌 방지). */
async function lockRequest(tx: Tx, requestId: number): Promise<{ room: RoomRow; req: RequestRow }> {
  const { rows } = await tx.query<{ room_id: number }>(`SELECT room_id FROM requests WHERE id = $1`, [requestId]);
  if (!rows[0]) throw new QueueError("REQUEST_NOT_FOUND", "신청을 찾을 수 없습니다.", 404);
  const room = await lockRoom(tx, rows[0].room_id);
  const req = (await tx.query<RequestRow>(`SELECT * FROM requests WHERE id = $1 FOR UPDATE`, [requestId])).rows[0];
  return { room, req };
}

async function queueRows(tx: Tx, roomId: number): Promise<RequestRow[]> {
  const { rows } = await tx.query<RequestRow>(
    `SELECT * FROM requests WHERE room_id = $1 AND status IN ('waiting','called') ORDER BY position, id`,
    [roomId],
  );
  return rows;
}

async function writeOrder(tx: Tx, ids: number[]) {
  for (let i = 0; i < ids.length; i++) {
    await tx.query(`UPDATE requests SET position = $2 WHERE id = $1`, [ids[i], i + 1]);
  }
}

async function transition(
  tx: Tx,
  req: RequestRow,
  to: RequestStatus,
  actorId: number | null,
  reason: string | null,
  set: Record<string, unknown> = {},
) {
  const cols = Object.keys(set);
  const assignments = ["status = $2", ...cols.map((c, i) => `${c} = $${i + 3}`)].join(", ");
  await tx.query(`UPDATE requests SET ${assignments} WHERE id = $1`, [req.id, to, ...cols.map((c) => set[c])]);
  await tx.query(
    `INSERT INTO status_events (request_id, from_status, to_status, actor_id, reason) VALUES ($1,$2,$3,$4,$5)`,
    [req.id, req.status, to, actorId, reason],
  );
}

async function userName(tx: Tx, userId: number): Promise<string> {
  const { rows } = await tx.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [userId]);
  return rows[0]?.name ?? "";
}

async function currentReport(tx: Tx, roomId: number): Promise<(RequestRow & { started_at: Date }) | null> {
  const { rows } = await tx.query<RequestRow & { started_at: Date }>(
    `SELECT * FROM requests WHERE room_id = $1 AND status = 'in_progress' ORDER BY started_at LIMIT 1`,
    [roomId],
  );
  return rows[0] ?? null;
}

function toCurrent(r: { expected_minutes: number; started_at: Date } | null): CurrentReport | null {
  return r ? { expectedMinutes: r.expected_minutes, startedAt: r.started_at } : null;
}

async function assertDesk(tx: Tx, actor: Actor, roomId: number) {
  if (actor.role === "admin") return;
  if (actor.role === "secretary") {
    const { rows } = await tx.query(`SELECT 1 FROM room_managers WHERE room_id = $1 AND user_id = $2`, [roomId, actor.id]);
    if (rows.length) return;
  }
  throw new QueueError("FORBIDDEN", "이 보고실을 관리할 권한이 없습니다.", 403);
}

function assertOwner(actor: Actor, req: RequestRow) {
  if (req.user_id !== actor.id) throw new QueueError("FORBIDDEN", "본인 신청만 조회·변경할 수 있습니다.", 403);
}

// ─── 단계형 알림 평가 (PRD §5.4) ─────────────────────────────────────────

interface PrefRow {
  user_id: number;
  name: string;
  prepare_enabled: boolean | null;
  prepare_by: "count" | "minutes" | null;
  prepare_value: number | null;
  imminent_enabled: boolean | null;
  kakao_for_prepare: boolean | null;
  kakao_for_imminent: boolean | null;
}

/**
 * 대기열이 바뀔 때마다 호출한다. 단계 진입 시에만 알림을 쌓고(dedupe),
 * 순번 변동 자체로는 알림을 만들지 않는다.
 */
async function evaluateStages(tx: Tx, fx: Effects, room: RoomRow) {
  fx.rooms.add(room.id);
  if (room.status !== "open") return; // 일시중지 등 불확실할 때는 준비/임박 알림을 보내지 않는다.

  const rows = await queueRows(tx, room.id);
  const current = await currentReport(tx, room.id);
  const estimates = estimateQueue(
    rows.map((r) => ({ id: r.id, expectedMinutes: r.expected_minutes })),
    toCurrent(current),
    { transitionMinutes: room.transition_minutes, certain: true, now: new Date() },
  );
  if (!rows.length) return;

  const { rows: prefs } = await tx.query<PrefRow>(
    `SELECT u.id AS user_id, u.name, p.prepare_enabled, p.prepare_by, p.prepare_value, p.imminent_enabled,
            p.kakao_for_prepare, p.kakao_for_imminent
       FROM users u LEFT JOIN notification_prefs p ON p.user_id = u.id
      WHERE u.id = ANY($1::int[])`,
    [rows.map((r) => r.user_id)],
  );
  const prefOf = new Map(prefs.map((p) => [p.user_id, p]));

  for (let i = 0; i < rows.length; i++) {
    const req = rows[i];
    if (req.status !== "waiting") continue;
    const est = estimates[i];
    const p = prefOf.get(req.user_id)!;
    // 앞에 호출된 건만 남았으면 다음 호출 대상이다.
    const isNext = rows.slice(0, i).every((r) => r.status === "called");

    if (isNext && (p.imminent_enabled ?? true)) {
      await enqueue(tx, fx, {
        requestId: req.id,
        recipientId: req.user_id,
        stage: "imminent",
        dedupeKey: `imminent:${req.id}`,
        inapp: true,
        kakao: p.kakao_for_imminent ?? false,
        message: messages.imminent(base(p.name, room, req)),
        kakaoLink: () => viewLink(tx, req.id),
      });
      continue;
    }

    if (!(p.prepare_enabled ?? true)) continue;
    const by = p.prepare_by ?? "count";
    const value = p.prepare_value ?? 3;
    const reached = by === "count" ? est.ahead <= value : est.etaMinutes != null && est.etaMinutes <= value;
    if (!reached) continue;
    await enqueue(tx, fx, {
      requestId: req.id,
      recipientId: req.user_id,
      stage: "prepare",
      dedupeKey: `prepare:${req.id}`,
      inapp: true,
      kakao: p.kakao_for_prepare ?? false,
      message: messages.prepare(base(p.name, room, req), { ahead: est.ahead, eta: est.etaMinutes }),
      kakaoLink: () => viewLink(tx, req.id),
    });
  }
}

function base(name: string, room: RoomRow, req: RequestRow): MessageBase {
  return { name, room: { name: room.name, location: room.location }, ticket: req.ticket_no, createdAt: req.created_at };
}

const isLive = (s: RequestStatus) => s === "waiting" || s === "called" || s === "held" || s === "in_progress";

/** 알림톡 [실시간 대기순서 확인] 버튼용 조회 링크. 로그인 없이 내 신청 상태만 본다 (12시간, 신청이 끝나면 무효). */
async function viewLink(tx: Tx, requestId: number) {
  const token = randomBytes(24).toString("base64url");
  await tx.query(
    `INSERT INTO call_tokens (request_id, call_no, token_hash, expires_at, kind)
     SELECT id, call_count, $2, now() + interval '12 hours', 'view' FROM requests WHERE id = $1`,
    [requestId, hashToken(token)],
  );
  return `${baseUrl()}/c/${token}`;
}

async function notifyChange(tx: Tx, fx: Effects, room: RoomRow, req: RequestRow, key: string, reason: string) {
  await enqueue(tx, fx, {
    requestId: req.id,
    recipientId: req.user_id,
    stage: "change",
    dedupeKey: `change:${key}:${req.id}`,
    inapp: true,
    kakao: true, // 변경 알림은 알림톡을 끌 수 없다
    message: messages.change(base(await userName(tx, req.user_id), room, req), { reason }),
    // 마감·취소 뒤에는 볼 대기순서가 없으므로 링크 버튼을 달지 않는다
    kakaoLink: isLive(req.status) && key !== "closed" && key !== "cancel" ? () => viewLink(tx, req.id) : undefined,
  });
}

/** 대기열에서 호출된 건들 바로 뒤 위치 (호출 건이 앞에 있지 않을 수도 있다) */
function afterLastCalled(queue: RequestRow[]) {
  let idx = 0;
  queue.forEach((r, i) => {
    if (r.status === "called") idx = i + 1;
  });
  return idx;
}

function cleanTitle(title: unknown) {
  if (title == null) return null;
  if (typeof title !== "string") throw new QueueError("INVALID_TITLE", "보고 제목 형식이 올바르지 않습니다.");
  return title.trim() ? title.trim().slice(0, 100) : null;
}

function assertId(v: unknown, name: string): asserts v is number {
  if (!Number.isInteger(v) || (v as number) <= 0) throw new QueueError("BAD_PARAM", `${name} 값이 올바르지 않습니다.`);
}

/**
 * 지난 날짜의 미처리 신청을 마감한다 (PRD §5.7 취소 사유: 마감).
 * 대기번호가 날짜별로 다시 시작하므로 남겨 두면 번호가 겹치고 재신청도 막힌다.
 */
async function closePreviousDaysInTx(tx: Tx, fx: Effects, room: RoomRow) {
  const { rows } = await tx.query<RequestRow>(
    `SELECT * FROM requests
      WHERE room_id = $1 AND status IN ('waiting','called','in_progress','held')
        AND service_date < (now() AT TIME ZONE 'Asia/Seoul')::date
      FOR UPDATE`,
    [room.id],
  );
  for (const req of rows) {
    if (req.status === "in_progress") {
      await transition(tx, req, "done", null, "일 마감 자동 종료", { position: null, ended_at: new Date() });
      continue;
    }
    await transition(tx, req, "cancelled", null, "일 마감", { position: null, cancel_reason: "closed",
      called_at: null, call_expires_at: null });
    await notifyChange(tx, fx, room, req, "closed", "지난 근무일 보고 신청이 마감 처리되었습니다. 필요하면 오늘 다시 줄을 서 주세요.");
  }
  if (rows.length) await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
  return rows.length;
}

/** 모든 보고실의 지난 날짜 신청 마감 (워커가 주기적으로 호출) */
export async function closePreviousDays(db: Db) {
  const fx = new Effects();
  const { rows } = await db.query<{ room_id: number }>(
    `SELECT DISTINCT room_id FROM requests
      WHERE status IN ('waiting','called','in_progress','held')
        AND service_date < (now() AT TIME ZONE 'Asia/Seoul')::date`,
  );
  for (const { room_id } of rows) {
    await db.transaction(async (tx) => {
      const room = await lockRoom(tx, room_id);
      if (await closePreviousDaysInTx(tx, fx, room)) fx.rooms.add(room.id);
    });
  }
  return fx;
}

// ─── 직원 기능 ───────────────────────────────────────────────────────────

export async function joinQueue(
  db: Db,
  actor: Actor,
  input: { roomId: number; expectedMinutes: number; title?: string | null; idempotencyKey?: string | null },
) {
  if (!EXPECTED_MINUTES.includes(input.expectedMinutes as never)) {
    throw new QueueError("INVALID_MINUTES", "예상 소요시간은 5/10/15/20분 중 하나여야 합니다.");
  }
  if (actor.role === "display") throw new QueueError("FORBIDDEN", "현황판 계정은 신청할 수 없습니다.", 403);
  const fx = new Effects();

  assertId(input.roomId, "roomId");
  const title = cleanTitle(input.title);
  const result = await db.transaction(async (tx) => {
    // 같은 키의 동시 요청이 보고실 잠금 뒤에서 기다렸다가도 중복으로 인식하도록 잠금 후에 확인한다.
    const room = await lockRoom(tx, input.roomId);
    if (input.idempotencyKey) {
      const { rows } = await tx.query<RequestRow>(`SELECT * FROM requests WHERE idempotency_key = $1`, [input.idempotencyKey]);
      if (rows[0]) {
        if (rows[0].user_id !== actor.id) throw new QueueError("FORBIDDEN", "잘못된 요청입니다.", 403);
        return { request: rows[0], duplicate: true };
      }
    }
    await closePreviousDaysInTx(tx, fx, room);
    if (room.status === "closed") throw new QueueError("ROOM_CLOSED", "오늘 접수가 마감되었습니다.");
    if (room.status !== "open" && !room.accepts_when_paused) {
      throw new QueueError("ROOM_PAUSED", "보고실이 일시중지 중이라 신규 접수를 받지 않습니다.");
    }
    if (!room.is_open_hours) throw new QueueError("OUT_OF_HOURS", "접수 가능 시간이 아닙니다.");

    const { rows: active } = await tx.query<{ id: number }>(
      `SELECT id FROM requests WHERE room_id = $1 AND user_id = $2 AND status IN ('waiting','called','in_progress','held')`,
      [room.id, actor.id],
    );
    if (active[0]) throw new QueueError("ALREADY_ACTIVE", "이미 이 보고실에 대기 중입니다.", 409);

    const queue = await queueRows(tx, room.id);
    const { rows } = await tx.query<RequestRow>(
      `INSERT INTO requests (room_id, user_id, service_date, ticket_no, title, expected_minutes, status, position, idempotency_key)
       VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Seoul')::date,
               (SELECT coalesce(max(ticket_no), 0) + 1 FROM requests
                 WHERE room_id = $1 AND service_date = (now() AT TIME ZONE 'Asia/Seoul')::date),
               $3, $4, 'waiting', $5, $6)
       RETURNING *`,
      [room.id, actor.id, title, input.expectedMinutes, queue.length + 1, input.idempotencyKey ?? null],
    );
    const request = rows[0];
    await tx.query(
      `INSERT INTO status_events (request_id, from_status, to_status, actor_id) VALUES ($1, NULL, 'waiting', $2)`,
      [request.id, actor.id],
    );
    await evaluateStages(tx, fx, room);
    return { request, duplicate: false };
  });
  fx.users.add(actor.id);
  return { ...result, fx };
}

export async function cancelBySelf(db: Db, actor: Actor, requestId: number) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    assertOwner(actor, req);
    if (!["waiting", "called", "held"].includes(req.status)) {
      throw new QueueError("INVALID_STATE", "이미 진행 중이거나 끝난 신청은 취소할 수 없습니다.");
    }
    await transition(tx, req, "cancelled", actor.id, "본인 취소", { position: null, cancel_reason: "self" });
    await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
    await evaluateStages(tx, fx, room);
  });
  fx.users.add(actor.id);
  return { fx };
}

/** 순서 미루기 (PRD §5.9): 1~3칸, 신청당 최대 5회. */
export async function deferBySelf(db: Db, actor: Actor, requestId: number, steps: number) {
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_DEFER_STEPS) {
    throw new QueueError("INVALID_STEPS", `한 번에 1~${MAX_DEFER_STEPS}칸까지 미룰 수 있습니다.`);
  }
  const fx = new Effects();
  const result = await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    assertOwner(actor, req);
    return deferInTx(tx, fx, room, req, steps, actor.id);
  });
  fx.users.add(actor.id);
  return { ...result, fx };
}

async function deferInTx(tx: Tx, fx: Effects, room: RoomRow, req: RequestRow, steps: number, actorId: number) {
  if (req.status !== "waiting" && req.status !== "called") {
    throw new QueueError("INVALID_STATE", "대기 중이거나 호출된 신청만 미룰 수 있습니다.");
  }
  if (req.defer_count >= MAX_DEFERS) {
    throw new QueueError("DEFER_LIMIT", `순서 미루기는 신청당 ${MAX_DEFERS}회까지 가능합니다. 취소 후 다시 신청해 주세요.`);
  }
  const ids = (await queueRows(tx, room.id)).map((r) => r.id);
  const from = ids.indexOf(req.id);
  const to = Math.min(from + steps, ids.length - 1);
  if (to === from) throw new QueueError("CANNOT_DEFER", "이미 마지막 순서입니다.");

  ids.splice(from, 1);
  ids.splice(to, 0, req.id);
  await writeOrder(tx, ids);
  if (req.status === "called") {
    await transition(tx, req, "waiting", actorId, `순서 미루기 ${to - from}칸`, {
      defer_count: req.defer_count + 1,
      called_at: null,
      call_expires_at: null,
    });
  } else {
    await tx.query(`UPDATE requests SET defer_count = defer_count + 1 WHERE id = $1`, [req.id]);
    await tx.query(
      `INSERT INTO status_events (request_id, from_status, to_status, actor_id, reason) VALUES ($1,$2,$2,$3,$4)`,
      [req.id, req.status, actorId, `순서 미루기 ${to - from}칸`],
    );
  }
  await evaluateStages(tx, fx, room);
  return { moved: to - from, remaining: MAX_DEFERS - req.defer_count - 1 };
}

/** 호출 응답. 앱 화면(via=app)과 알림톡 링크(via=link) 모두 여기로 들어온다. */
export async function respondToCall(
  db: Db,
  actor: Actor,
  requestId: number,
  response: CallResponse,
  via: "app" | "link" = "app",
  /** 링크 응답일 때 링크가 발급된 호출 회차. 잠금 안에서 다시 확인한다. */
  expectedCallNo?: number,
) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    assertOwner(actor, req);
    if (req.status !== "called") throw new QueueError("NOT_CALLED", "호출된 상태가 아닙니다.");
    if (expectedCallNo != null && expectedCallNo !== req.call_count) {
      throw new QueueError("LINK_EXPIRED", "새 호출이 있어 이 링크는 만료되었습니다. 가장 최근 알림을 확인해 주세요.", 410);
    }
    if (response === "delay_5") {
      const { rows } = await tx.query(
        `SELECT 1 FROM call_responses WHERE request_id = $1 AND response = 'delay_5' AND responded_at >= $2`,
        [req.id, req.called_at],
      );
      if (rows.length) throw new QueueError("DELAY_USED", "‘5분 뒤 가능’은 호출당 한 번만 쓸 수 있습니다.");
    }
    await tx.query(`INSERT INTO call_responses (request_id, response, via) VALUES ($1,$2,$3)`, [req.id, response, via]);

    if (response === "delay_5") {
      await tx.query(`UPDATE requests SET call_expires_at = greatest(call_expires_at, now()) + interval '5 minutes' WHERE id = $1`, [req.id]);
    } else if (response === "defer") {
      await deferInTx(tx, fx, room, req, 1, actor.id);
    } else if (response === "cancel") {
      await transition(tx, req, "cancelled", actor.id, "호출 응답: 취소", { position: null, cancel_reason: "self" });
      await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
    }
    await evaluateStages(tx, fx, room);
  });
  fx.users.add(actor.id);
  return { fx };
}

// ─── 비서실 기능 ─────────────────────────────────────────────────────────

/** 호출. requestId가 없으면 맨 앞 대기자를 부른다. 이미 호출된 건이면 재호출. */
export async function call(db: Db, actor: Actor, roomId: number, requestId?: number) {
  if (requestId != null) assertId(requestId, "requestId");
  const fx = new Effects();
  const result = await db.transaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    await assertDesk(tx, actor, roomId);
    await closePreviousDaysInTx(tx, fx, room);
    return callInTx(tx, fx, room, actor, requestId);
  });
  return { ...result, fx };
}

async function callInTx(tx: Tx, fx: Effects, room: RoomRow, actor: Actor, requestId?: number) {
  const queue = await queueRows(tx, room.id);
  // [다음 순번 호출]을 두 화면에서 동시에 눌러도 두 명이 불리지 않도록, 호출 중인 사람이 있으면 막는다.
  if (!requestId && queue.some((r) => r.status === "called")) {
    throw new QueueError("ALREADY_CALLED", "이미 호출 중인 직원이 있습니다. 재호출이나 다른 직원 호출은 해당 줄에서 하세요.", 409);
  }
  const req = requestId ? queue.find((r) => r.id === requestId) : queue.find((r) => r.status === "waiting");
  if (!req) throw new QueueError("NOTHING_TO_CALL", requestId ? "호출할 수 없는 신청입니다." : "대기 중인 직원이 없습니다.");

  const callNo = req.call_count + 1;
  const token = randomBytes(24).toString("base64url");
  const recall = req.status === "called";
  await transition(tx, req, "called", actor.id, recall ? `재호출 ${callNo}회차` : null, {
    called_at: new Date(),
    call_expires_at: new Date(Date.now() + room.grace_minutes * 60_000),
    call_count: callNo,
  });
  // 링크는 이번 호출에만 유효하다. 상태가 바뀌거나 재호출되면 무효가 된다.
  await tx.query(
    `INSERT INTO call_tokens (request_id, call_no, token_hash, expires_at) VALUES ($1,$2,$3, now() + interval '30 minutes')`,
    [req.id, callNo, hashToken(token)],
  );
  const link = `${baseUrl()}/c/${token}`;
  await enqueue(tx, fx, {
    requestId: req.id,
    recipientId: req.user_id,
    stage: "call",
    dedupeKey: `call:${req.id}:${callNo}`,
    inapp: true,
    kakao: true, // 지금 입장은 알림톡을 끌 수 없다
    message: messages.call(base(await userName(tx, req.user_id), room, req), { grace: room.grace_minutes, link }),
  });
  await evaluateStages(tx, fx, room);
  return { requestId: req.id, callNo, link };
}

export async function start(db: Db, actor: Actor, requestId: number) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "called" && req.status !== "waiting") throw new QueueError("INVALID_STATE", "대기 또는 호출 상태만 시작할 수 있습니다.");
    if (await currentReport(tx, room.id)) throw new QueueError("ROOM_BUSY", "이미 진행 중인 보고가 있습니다. 먼저 종료해 주세요.");
    await transition(tx, req, "in_progress", actor.id, null, { position: null, started_at: new Date() });
    await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
    await evaluateStages(tx, fx, room);
    fx.users.add(req.user_id);
  });
  return { fx };
}

/** 종료. callNext면 같은 트랜잭션에서 다음 대기자를 호출한다 ([종료 후 다음 호출]). */
export async function end(db: Db, actor: Actor, requestId: number, callNext = false) {
  const fx = new Effects();
  const result = await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "in_progress") throw new QueueError("INVALID_STATE", "진행 중인 보고만 종료할 수 있습니다.");
    await transition(tx, req, "done", actor.id, null, { ended_at: new Date() });
    fx.users.add(req.user_id);
    const rest = await queueRows(tx, room.id);
    if (callNext && room.status === "open" && rest.some((r) => r.status === "waiting") && !rest.some((r) => r.status === "called")) {
      return { next: await callInTx(tx, fx, room, actor) };
    }
    await evaluateStages(tx, fx, room);
    return { next: null };
  });
  return { ...result, fx };
}

export async function hold(db: Db, actor: Actor, requestId: number, reason: string) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "waiting" && req.status !== "called") throw new QueueError("INVALID_STATE", "대기·호출 상태만 보류할 수 있습니다.");
    await transition(tx, req, "held", actor.id, reason || "보류", { position: null, called_at: null, call_expires_at: null });
    await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
    await notifyChange(tx, fx, room, req, `hold:${Date.now()}`, `보고가 보류되었습니다. 사유: ${reason || "비서실 확인 중"}`);
    await evaluateStages(tx, fx, room);
  });
  return { fx };
}

/** 보류 해제: 대기열 맨 앞(호출 중인 건 뒤)으로 복귀 */
export async function resume(db: Db, actor: Actor, requestId: number) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "held") throw new QueueError("INVALID_STATE", "보류된 신청이 아닙니다.");
    const queue = await queueRows(tx, room.id);
    const ids = queue.map((r) => r.id);
    ids.splice(afterLastCalled(queue), 0, req.id);
    await transition(tx, req, "waiting", actor.id, "보류 해제");
    await writeOrder(tx, ids);
    await evaluateStages(tx, fx, room);
    fx.users.add(req.user_id);
  });
  return { fx };
}

export async function cancelByDesk(db: Db, actor: Actor, requestId: number, reason: string) {
  if (!reason?.trim()) throw new QueueError("REASON_REQUIRED", "취소 사유를 입력해 주세요.");
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (!["waiting", "called", "held"].includes(req.status)) throw new QueueError("INVALID_STATE", "취소할 수 없는 상태입니다.");
    await transition(tx, req, "cancelled", actor.id, reason, { position: null, cancel_reason: "desk" });
    await writeOrder(tx, (await queueRows(tx, room.id)).map((r) => r.id));
    // 취소는 반드시 사유와 함께 알린다 (PRD §4.3)
    await notifyChange(tx, fx, room, req, "cancel", `비서실에서 보고 신청을 취소했습니다. 사유: ${reason}. 필요하면 다시 줄을 서 주세요.`);
    await evaluateStages(tx, fx, room);
  });
  return { fx };
}

/** 무응답 시 "다음 순번 먼저": 호출을 풀고 바로 뒤로 한 칸. 직원의 미루기 횟수는 쓰지 않는다. */
export async function skipNoResponse(db: Db, actor: Actor, requestId: number) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "called") throw new QueueError("INVALID_STATE", "호출 상태가 아닙니다.");
    const ids = (await queueRows(tx, room.id)).map((r) => r.id);
    const from = ids.indexOf(req.id);
    const to = Math.min(from + 1, ids.length - 1);
    ids.splice(from, 1);
    ids.splice(to, 0, req.id);
    await transition(tx, req, "waiting", actor.id, "무응답: 다음 순번 먼저", { called_at: null, call_expires_at: null });
    await writeOrder(tx, ids);
    await notifyChange(tx, fx, room, req, `skip:${req.call_count}`,
      "호출에 응답이 없어 다음 순번이 먼저 보고합니다. 순서는 바로 뒤로 유지됩니다.");
    await evaluateStages(tx, fx, room);
  });
  return { fx };
}

export async function moveTo(db: Db, actor: Actor, requestId: number, newIndex: number) {
  assertId(requestId, "requestId");
  if (!Number.isInteger(newIndex)) throw new QueueError("BAD_PARAM", "옮길 위치가 올바르지 않습니다.");
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const { room, req } = await lockRequest(tx, requestId);
    await assertDesk(tx, actor, room.id);
    if (req.status !== "waiting" && req.status !== "called") throw new QueueError("INVALID_STATE", "대기열에 있는 신청만 옮길 수 있습니다.");
    const ids = (await queueRows(tx, room.id)).map((r) => r.id);
    const from = ids.indexOf(req.id);
    const to = Math.max(0, Math.min(newIndex, ids.length - 1));
    ids.splice(from, 1);
    ids.splice(to, 0, req.id);
    await writeOrder(tx, ids);
    await tx.query(
      `INSERT INTO status_events (request_id, from_status, to_status, actor_id, reason) VALUES ($1,$2,$2,$3,$4)`,
      [req.id, req.status, actor.id, `순서 변경 ${from + 1}→${to + 1}`],
    );
    await evaluateStages(tx, fx, room);
  });
  return { fx };
}

/** 긴급보고 삽입: 호출 중인 건 바로 뒤에 넣고, 밀려난 대기자에게 변경 알림을 1회만 보낸다. */
export async function insertUrgent(
  db: Db,
  actor: Actor,
  input: { roomId: number; userId: number; expectedMinutes: number; reason: string; title?: string | null },
) {
  if (!input.reason?.trim()) throw new QueueError("REASON_REQUIRED", "긴급보고 사유를 입력해 주세요.");
  if (!EXPECTED_MINUTES.includes(input.expectedMinutes as never)) throw new QueueError("INVALID_MINUTES", "예상 소요시간이 올바르지 않습니다.");
  assertId(input.userId, "userId");
  const title = cleanTitle(input.title);
  const fx = new Effects();
  const result = await db.transaction(async (tx) => {
    const room = await lockRoom(tx, input.roomId);
    await assertDesk(tx, actor, room.id);
    const { rows: target } = await tx.query(
      `SELECT 1 FROM users WHERE id = $1 AND active AND role IN ('staff','executive')`, [input.userId]);
    if (!target.length) throw new QueueError("USER_NOT_FOUND", "긴급보고를 넣을 직원을 찾을 수 없습니다.", 404);
    await closePreviousDaysInTx(tx, fx, room);
    const before = await queueRows(tx, room.id);

    const { rows: existing } = await tx.query<RequestRow>(
      `SELECT * FROM requests WHERE room_id = $1 AND user_id = $2 AND status IN ('waiting','called','in_progress','held')`,
      [room.id, input.userId],
    );
    let req: RequestRow;
    if (existing[0]) {
      req = existing[0];
      if (req.status === "in_progress") throw new QueueError("INVALID_STATE", "이미 보고 중인 직원입니다.");
      await tx.query(`UPDATE requests SET priority = 'urgent', urgent_reason = $2 WHERE id = $1`, [req.id, input.reason]);
      if (req.status === "held") await transition(tx, req, "waiting", actor.id, `긴급 지정: ${input.reason}`);
    } else {
      const { rows } = await tx.query<RequestRow>(
        `INSERT INTO requests (room_id, user_id, service_date, ticket_no, title, expected_minutes, status, priority, urgent_reason)
         VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Seoul')::date,
                 (SELECT coalesce(max(ticket_no), 0) + 1 FROM requests
                   WHERE room_id = $1 AND service_date = (now() AT TIME ZONE 'Asia/Seoul')::date),
                 $3, $4, 'waiting', 'urgent', $5)
         RETURNING *`,
        [room.id, input.userId, title, input.expectedMinutes, input.reason],
      );
      req = rows[0];
      await tx.query(
        `INSERT INTO status_events (request_id, from_status, to_status, actor_id, reason) VALUES ($1, NULL, 'waiting', $2, $3)`,
        [req.id, actor.id, `긴급보고: ${input.reason}`],
      );
    }

    const ids = before.map((r) => r.id).filter((id) => id !== req.id);
    ids.splice(afterLastCalled(before.filter((r) => r.id !== req.id)), 0, req.id);
    await writeOrder(tx, ids);

    // 새 순서에서 뒤로 밀린 대기자에게만 1회 알림
    const oldIndex = new Map(before.map((r, i) => [r.id, i]));
    for (const r of before) {
      if (r.id === req.id || r.status !== "waiting") continue;
      if (ids.indexOf(r.id) > oldIndex.get(r.id)!) {
        await notifyChange(tx, fx, room, r, `urgent:${req.id}`, "긴급보고가 추가되어 예상 시각이 변경되었습니다.");
      }
    }
    await evaluateStages(tx, fx, room);
    fx.users.add(input.userId);
    return { requestId: req.id };
  });
  return { ...result, fx };
}

export async function setRoomStatus(db: Db, actor: Actor, roomId: number, status: RoomStatus, reason?: string) {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const room = await lockRoom(tx, roomId);
    await assertDesk(tx, actor, roomId);
    if (room.status === status) return;
    await tx.query(`UPDATE rooms SET status = $2 WHERE id = $1`, [roomId, status]);
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO room_events (room_id, status, actor_id, reason) VALUES ($1,$2,$3,$4) RETURNING id`,
      [roomId, status, actor.id, reason ?? null],
    );
    const updated = { ...room, status };
    const { rows: held } = await tx.query<RequestRow>(`SELECT * FROM requests WHERE room_id = $1 AND status = 'held'`, [roomId]);
    const affected = [...(await queueRows(tx, roomId)), ...held];
    const label = { open: "", paused: "일시중지", external: "외부 일정", closed: "마감" }[status];
    const text = status === "open"
      ? `${room.name} 보고가 재개되었습니다. 내 순서와 예상 시각을 확인해 주세요.`
      : `${room.name}이(가) ${label} 상태로 바뀌었습니다. 대기 순서는 그대로 유지되며, 재개되면 다시 안내드립니다.`;
    for (const r of affected) await notifyChange(tx, fx, updated, r, `room:${rows[0].id}`, text);
    await evaluateStages(tx, fx, updated);
  });
  fx.rooms.add(roomId);
  return { fx };
}

// ─── 1회용 호출 링크 ─────────────────────────────────────────────────────

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** 링크 토큰으로 호출 건을 찾는다. 이번 호출이 아니거나 만료됐으면 null. */
export async function resolveCallToken(db: Db, token: string) {
  const { rows } = await db.query<{ request_id: number; user_id: number; call_no: number; call_count: number; status: RequestStatus; expired: boolean; kind: "call" | "view" }>(
    `SELECT t.request_id, r.user_id, t.call_no, r.call_count, r.status, t.expires_at < now() AS expired, t.kind
       FROM call_tokens t JOIN requests r ON r.id = t.request_id
      WHERE t.token_hash = $1`,
    [hashToken(token)],
  );
  const t = rows[0];
  if (!t) return null;
  // 호출 링크: 이번 호출 회차에만 유효. 조회 링크: 신청이 진행 중인 동안 유효 (호출되면 그 회차로 응답 가능).
  const valid = t.kind === "call"
    ? !t.expired && t.status === "called" && t.call_no === t.call_count
    : !t.expired && isLive(t.status);
  return { requestId: t.request_id, userId: t.user_id, callNo: t.kind === "call" ? t.call_no : t.call_count, status: t.status, kind: t.kind, valid };
}

// ─── 조회 ───────────────────────────────────────────────────────────────

/** 여러 쿼리로 만드는 화면 데이터가 한 시점의 상태를 보도록 읽기 전용 스냅샷에서 읽는다. */
function readSnapshot<T>(db: Db, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return fn(tx);
  });
}

async function roomSnapshot(tx: Tx, room: RoomRow) {
  const rows = await queueRows(tx, room.id);
  const current = await currentReport(tx, room.id);
  const opts = { transitionMinutes: room.transition_minutes, certain: room.status === "open", now: new Date() };
  const items = rows.map((r) => ({ id: r.id, expectedMinutes: r.expected_minutes }));
  return {
    rows,
    current,
    estimates: estimateQueue(items, toCurrent(current), opts),
    newJoinerEta: estimateNewJoiner(items, toCurrent(current), opts),
  };
}

async function allRooms(tx: Tx) {
  return (await tx.query<RoomRow>(`SELECT ${ROOM_COLS} FROM rooms ORDER BY id`)).rows;
}

async function roomById(tx: Tx, roomId: number) {
  const room = (await tx.query<RoomRow>(`SELECT ${ROOM_COLS} FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (!room) throw new QueueError("ROOM_NOT_FOUND", "보고실을 찾을 수 없습니다.", 404);
  return room;
}

function publicRoom(room: RoomRow) {
  return { id: room.id, name: room.name, location: room.location, status: room.status, isOpenHours: room.is_open_hours,
    acceptsNew: room.status === "open" || (room.status !== "closed" && room.accepts_when_paused) };
}

/** 직원 홈: 다른 직원의 이름·제목은 포함하지 않는다. */
export function staffHome(db: Db, actor: Actor) {
  return readSnapshot(db, (tx) => staffHomeTx(tx, actor));
}

async function staffHomeTx(db: Tx, actor: Actor) {
  const rooms = await allRooms(db);
  const out = [];
  for (const room of rooms) {
    const snap = await roomSnapshot(db, room);
    const mineIdx = snap.rows.findIndex((r) => r.user_id === actor.id);
    const mine = mineIdx >= 0 ? snap.rows[mineIdx] : null;
    const myCurrent = snap.current?.user_id === actor.id ? snap.current : null;
    const { rows: held } = await db.query<RequestRow>(
      `SELECT * FROM requests WHERE room_id = $1 AND user_id = $2 AND status = 'held'`, [room.id, actor.id]);
    const own = mine ?? myCurrent ?? held[0] ?? null;
    out.push({
      ...publicRoom(room),
      busy: !!snap.current,
      waitingCount: snap.rows.length,
      newJoinerEta: snap.newJoinerEta,
      myRequest: own ? {
        id: own.id,
        ticketNo: own.ticket_no,
        status: own.status,
        ahead: mine ? snap.estimates[mineIdx].ahead : 0,
        etaMinutes: mine ? snap.estimates[mineIdx].etaMinutes : null,
      } : null,
    });
  }
  return { rooms: out, serverTime: new Date().toISOString() };
}

/** 내 대기현황 */
export function myRequest(db: Db, actor: Actor, requestId: number) {
  return readSnapshot(db, (tx) => myRequestTx(tx, actor, requestId));
}

async function myRequestTx(db: Tx, actor: Actor, requestId: number) {
  const req = (await db.query<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [requestId])).rows[0];
  if (!req) throw new QueueError("REQUEST_NOT_FOUND", "신청을 찾을 수 없습니다.", 404);
  assertOwner(actor, req);
  const room = await roomById(db, req.room_id);
  const snap = await roomSnapshot(db, room);
  const idx = snap.rows.findIndex((r) => r.id === req.id);
  const { rows: events } = await db.query<{ to_status: string; reason: string | null; occurred_at: Date }>(
    `SELECT to_status, reason, occurred_at FROM status_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1`, [req.id]);
  return {
    room: { ...publicRoom(room), graceMinutes: room.grace_minutes },
    request: {
      id: req.id,
      ticketNo: req.ticket_no,
      title: req.title,
      expectedMinutes: req.expected_minutes,
      status: req.status,
      priority: req.priority,
      deferCount: req.defer_count,
      defersLeft: MAX_DEFERS - req.defer_count,
      callExpiresAt: req.call_expires_at?.toISOString() ?? null,
      createdAt: req.created_at.toISOString(),
      lastEvent: events[0] ? { status: events[0].to_status, reason: events[0].reason, at: events[0].occurred_at.toISOString() } : null,
    },
    ahead: idx >= 0 ? snap.estimates[idx].ahead : null,
    position: idx >= 0 ? idx + 1 : null,
    etaMinutes: idx >= 0 ? snap.estimates[idx].etaMinutes : null,
    queueLength: snap.rows.length,
    serverTime: new Date().toISOString(),
  };
}

/** 비서실 대시보드: 담당 보고실만, 이름·부서·제목·알림 도달 상태 포함 */
export function deskView(db: Db, actor: Actor, roomId: number) {
  return readSnapshot(db, (tx) => deskViewTx(tx, actor, roomId));
}

async function deskViewTx(db: Tx, actor: Actor, roomId: number) {
  await assertDesk(db, actor, roomId);
  const room = await roomById(db, roomId);
  const snap = await roomSnapshot(db, room);
  const { rows: people } = await db.query<RequestRow & { name: string; department: string | null; phone: boolean }>(
    `SELECT r.*, u.name, d.name AS department, (c.user_id IS NOT NULL) AS phone
       FROM requests r JOIN users u ON u.id = r.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN user_contacts c ON c.user_id = u.id
      WHERE r.room_id = $1
        AND (r.status IN ('waiting','called','in_progress','held')
             OR (r.service_date = (now() AT TIME ZONE 'Asia/Seoul')::date AND r.status IN ('done','cancelled')))`,
    [roomId],
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const ids = people.map((p) => p.id);
  const { rows: notes } = ids.length ? await db.query<{ request_id: number; stage: string; channel: string; status: string; error: string | null; created_at: Date }>(
    `SELECT DISTINCT ON (request_id, channel) request_id, stage, channel, status, error, created_at
       FROM notifications WHERE request_id = ANY($1::int[]) AND stage IN ('call','change')
      ORDER BY request_id, channel, id DESC`, [ids]) : { rows: [] };
  const { rows: responses } = ids.length ? await db.query<{ request_id: number; response: string; responded_at: Date }>(
    `SELECT DISTINCT ON (request_id) request_id, response, responded_at FROM call_responses
      WHERE request_id = ANY($1::int[]) ORDER BY request_id, id DESC`, [ids]) : { rows: [] };

  const now = Date.now();
  const view = (r: RequestRow) => {
    const p = byId.get(r.id)!;
    const last = responses.find((x) => x.request_id === r.id);
    return {
      id: r.id,
      ticketNo: r.ticket_no,
      name: p.name,
      department: p.department,
      title: r.title,
      expectedMinutes: r.expected_minutes,
      status: r.status,
      priority: r.priority,
      urgentReason: r.urgent_reason,
      deferCount: r.defer_count,
      callCount: r.call_count,
      calledAt: r.called_at?.toISOString() ?? null,
      callExpiresAt: r.call_expires_at?.toISOString() ?? null,
      noResponse: r.status === "called" && !!r.call_expires_at && r.call_expires_at.getTime() < now
        && !(last && r.called_at && last.responded_at >= r.called_at),
      lastResponse: last && r.called_at && last.responded_at >= r.called_at ? last.response : null,
      startedAt: r.started_at?.toISOString() ?? null,
      hasPhone: p.phone,
      delivery: notes.filter((n) => n.request_id === r.id).map((n) => ({ stage: n.stage, channel: n.channel, status: n.status, error: n.error })),
    };
  };
  return {
    room: { ...publicRoom(room), graceMinutes: room.grace_minutes },
    current: snap.current ? view(snap.current) : null,
    queue: snap.rows.map((r, i) => ({ ...view(r), etaMinutes: snap.estimates[i].etaMinutes })),
    held: people.filter((p) => p.status === "held").map(view),
    finished: people.filter((p) => p.status === "done" || p.status === "cancelled")
      .sort((a, b) => b.id - a.id).slice(0, 10).map(view),
    serverTime: new Date().toISOString(),
  };
}

/** 보고실 앞 현황판: 번호와 상태만 */
export function boardView(db: Db, roomId: number) {
  return readSnapshot(db, (tx) => boardViewTx(tx, roomId));
}

async function boardViewTx(db: Tx, roomId: number) {
  const room = await roomById(db, roomId);
  const snap = await roomSnapshot(db, room);
  return {
    room: { name: room.name, location: room.location, status: room.status },
    currentTicket: snap.current?.ticket_no ?? null,
    calledTickets: snap.rows.filter((r) => r.status === "called").map((r) => r.ticket_no),
    nextTickets: snap.rows.filter((r) => r.status === "waiting").slice(0, 3).map((r) => r.ticket_no),
    waitingCount: snap.rows.length,
    serverTime: new Date().toISOString(),
  };
}

export async function deskRooms(db: Db, actor: Actor) {
  if (actor.role === "admin") return allRooms(db).then((r) => r.map(publicRoom));
  const { rows } = await db.query<RoomRow>(
    `SELECT ${ROOM_COLS} FROM rooms WHERE id IN (SELECT room_id FROM room_managers WHERE user_id = $1) ORDER BY id`, [actor.id]);
  return rows.map(publicRoom);
}

export async function findStaff(db: Db, actor: Actor, q: string) {
  if (actor.role !== "secretary" && actor.role !== "admin") throw new QueueError("FORBIDDEN", "권한이 없습니다.", 403);
  const { rows } = await db.query<{ id: number; name: string; department: string | null; employee_id: string }>(
    `SELECT u.id, u.name, d.name AS department, u.employee_id FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.active AND u.role IN ('staff','executive') AND (u.name LIKE $1 OR u.employee_id LIKE $1) ORDER BY u.name LIMIT 10`,
    [`%${q}%`],
  );
  return rows;
}
