import type { Db } from "./client";

// 순서대로 한 번만 적용한다. 이미 배포된 항목은 수정하지 말고 새 항목을 추가한다.
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: /* sql */ `
CREATE TABLE departments (
  id   serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  employee_id   text NOT NULL UNIQUE,
  name          text NOT NULL,
  department_id int REFERENCES departments(id),
  role          text NOT NULL CHECK (role IN ('staff','secretary','executive','admin','display')),
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE user_contacts (
  user_id         int PRIMARY KEY REFERENCES users(id),
  phone_e164      text NOT NULL,
  consent_at      timestamptz NOT NULL,
  consent_version text NOT NULL
);

CREATE TABLE notification_prefs (
  user_id            int PRIMARY KEY REFERENCES users(id),
  prepare_enabled    boolean NOT NULL DEFAULT true,
  prepare_by         text NOT NULL DEFAULT 'count' CHECK (prepare_by IN ('count','minutes')),
  prepare_value      int NOT NULL DEFAULT 3,
  imminent_enabled   boolean NOT NULL DEFAULT true,
  kakao_for_prepare  boolean NOT NULL DEFAULT false,
  kakao_for_imminent boolean NOT NULL DEFAULT false
);

CREATE TABLE rooms (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  location            text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','external','closed')),
  accepts_when_paused boolean NOT NULL DEFAULT false,
  open_from           time NOT NULL DEFAULT '09:00',
  open_until          time NOT NULL DEFAULT '18:00',
  grace_minutes       int NOT NULL DEFAULT 3,
  transition_minutes  int NOT NULL DEFAULT 1
);

CREATE TABLE room_managers (
  room_id int NOT NULL REFERENCES rooms(id),
  user_id int NOT NULL REFERENCES users(id),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE requests (
  id               serial PRIMARY KEY,
  room_id          int NOT NULL REFERENCES rooms(id),
  user_id          int NOT NULL REFERENCES users(id),
  service_date     date NOT NULL,
  ticket_no        int NOT NULL,
  title            text,
  expected_minutes int NOT NULL CHECK (expected_minutes IN (5,10,15,20)),
  status           text NOT NULL CHECK (status IN ('waiting','called','in_progress','done','held','cancelled')),
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  urgent_reason    text,
  position         int,
  defer_count      int NOT NULL DEFAULT 0,
  call_count       int NOT NULL DEFAULT 0,
  called_at        timestamptz,
  call_expires_at  timestamptz,
  started_at       timestamptz,
  ended_at         timestamptz,
  cancel_reason    text,
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, service_date, ticket_no)
);
-- 보고실별 활성 신청은 1인 1건
CREATE UNIQUE INDEX requests_one_active_per_user
  ON requests (room_id, user_id) WHERE status IN ('waiting','called','in_progress','held');
CREATE INDEX requests_room_queue ON requests (room_id, status, position);

CREATE TABLE status_events (
  id          serial PRIMARY KEY,
  request_id  int NOT NULL REFERENCES requests(id),
  from_status text,
  to_status   text NOT NULL,
  actor_id    int REFERENCES users(id),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_responses (
  id           serial PRIMARY KEY,
  request_id   int NOT NULL REFERENCES requests(id),
  response     text NOT NULL CHECK (response IN ('on_way','delay_5','defer','cancel')),
  via          text NOT NULL CHECK (via IN ('app','link')),
  responded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_tokens (
  id         serial PRIMARY KEY,
  request_id int NOT NULL REFERENCES requests(id),
  call_no    int NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE TABLE room_events (
  id          serial PRIMARY KEY,
  room_id     int NOT NULL REFERENCES rooms(id),
  status      text NOT NULL,
  actor_id    int REFERENCES users(id),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id                  serial PRIMARY KEY,
  request_id          int REFERENCES requests(id),
  recipient_id        int NOT NULL REFERENCES users(id),
  stage               text NOT NULL CHECK (stage IN ('accepted','prepare','imminent','call','change')),
  channel             text NOT NULL CHECK (channel IN ('inapp','kakao')),
  dedupe_key          text NOT NULL UNIQUE,
  title               text NOT NULL,
  body                text NOT NULL,
  link                text,
  template_vars       jsonb,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','delivered','fallback_sms','failed','skipped')),
  attempts            int NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz
);
CREATE INDEX notifications_outbox ON notifications (channel, status, next_attempt_at);
CREATE INDEX notifications_recipient ON notifications (recipient_id, created_at DESC);
`,
  },
  {
    // 알림톡 [실시간 대기순서 확인] 버튼용 조회 링크
    id: "0002_view_tokens",
    sql: /* sql */ `
ALTER TABLE call_tokens ADD COLUMN kind text NOT NULL DEFAULT 'call' CHECK (kind IN ('call','view'));
`,
  },
];

export async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM schema_migrations`);
  const applied = new Set(rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of splitStatements(m.sql)) await tx.query(stmt);
      await tx.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [m.id]);
    });
  }
}

// 확장 쿼리 프로토콜은 한 번에 한 문장만 받으므로 나눠서 실행한다.
function splitStatements(sql: string) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
