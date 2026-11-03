// 카카오 알림톡 템플릿 (강조표기형). 카카오 검수에 그대로 제출하는 원문이다.
// 검수 후에는 문구를 바꾸면 발송이 거절되므로, 수정할 때는 새 코드로 다시 검수받는다.
// 보고 제목 등 업무 내용은 변수로도 넣지 않는다 (PRD §5.4.1).

export type Stage = "prepare" | "imminent" | "call" | "change";

export interface AlimtalkTemplate {
  code: string;
  name: string;
  /** 강조표기 보조문구 (작은 글씨, 제목 위) */
  emphasisSubtitle: string;
  /** 강조표기 제목 (큰 글씨) */
  emphasisTitle: string;
  body: string;
  /** 부가정보 (회색 작은 글씨) */
  extra: string;
  button: { name: string; type: "WL" };
}

const INFO = `- 접수일: #{접수일시}
- 보고실: #{보고실}
- 위치: #{위치}
- 신청자: #{이름}`;

const EXTRA = `본 알림톡은 강남구청 똑보(대면보고 대기 서비스)에서 발송되었습니다.
보고 제목 등 업무 내용은 담지 않으며, 연락처는 호출 알림 목적으로만 사용합니다.`;

export const TEMPLATES: Record<Stage, AlimtalkTemplate> = {
  prepare: {
    code: process.env.KAKAO_TPL_PREPARE ?? "TTOKBO_PREPARE",
    name: "준비 알림",
    emphasisSubtitle: "현재 대기순서",
    emphasisTitle: "#{대기번호}번",
    body: `${INFO}

내 앞에 #{앞건수}건 남았어요. (#{예상시간})
자리에서 준비해 주시면, 차례가 되었을 때 다시 알려드려요.`,
    extra: EXTRA,
    button: { name: "실시간 대기순서 확인", type: "WL" },
  },
  imminent: {
    code: process.env.KAKAO_TPL_IMMINENT ?? "TTOKBO_IMMINENT",
    name: "임박 알림",
    emphasisSubtitle: "곧 내 차례예요",
    emphasisTitle: "#{대기번호}번 · 다음 순서",
    body: `${INFO}

다음 순서입니다. 보고실로 출발할 준비를 해 주세요.`,
    extra: EXTRA,
    button: { name: "실시간 대기순서 확인", type: "WL" },
  },
  call: {
    code: process.env.KAKAO_TPL_CALL ?? "TTOKBO_CALL",
    name: "호출(지금 입장)",
    emphasisSubtitle: "지금 입장해 주세요",
    emphasisTitle: "#{대기번호}번 호출",
    body: `${INFO}

#{이름}님, 보고 차례입니다.
#{유예시간}분 안에 아래 버튼으로 응답해 주세요.`,
    extra: EXTRA,
    button: { name: "지금 응답하기", type: "WL" },
  },
  change: {
    code: process.env.KAKAO_TPL_CHANGE ?? "TTOKBO_CHANGE",
    name: "대기 변경 안내",
    emphasisSubtitle: "대기 변경 안내",
    emphasisTitle: "#{대기번호}번",
    body: `${INFO}

#{안내}`,
    extra: EXTRA,
    button: { name: "실시간 대기순서 확인", type: "WL" },
  },
};

export interface RenderedAlimtalk {
  templateCode: string;
  emphasisSubtitle: string;
  emphasisTitle: string;
  text: string;
  extra: string;
  button: { name: string; url: string } | null;
  /** 알림톡 실패 시 보낼 문자(LMS) 본문 */
  smsText: string;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/#\{([^}]+)\}/g, (_, k: string) => vars[k] ?? "");

export function renderAlimtalk(stage: Stage, vars: Record<string, string>, url: string | null): RenderedAlimtalk {
  const t = TEMPLATES[stage];
  const r = {
    templateCode: t.code,
    emphasisSubtitle: fill(t.emphasisSubtitle, vars),
    emphasisTitle: fill(t.emphasisTitle, vars),
    text: fill(t.body, vars),
    extra: fill(t.extra, vars),
    button: url ? { name: t.button.name, url } : null,
  };
  const smsText = [`[똑보] ${r.emphasisSubtitle}`, r.emphasisTitle, "", r.text, ...(r.button ? ["", `${r.button.name}: ${r.button.url}`] : [])].join("\n");
  return { ...r, smsText };
}

/** "2026.11.03 (화) 오후 02:43" — 똑닥 알림톡과 같은 표기 */
export function formatKoreanDateTime(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}.${parts.month}.${parts.day} (${parts.weekday}) ${parts.dayPeriod} ${parts.hour}:${parts.minute}`;
}
