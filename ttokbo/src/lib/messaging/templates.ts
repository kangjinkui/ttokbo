// 문자 알림 문구. 똑닥 대기순서 안내처럼 "번호 강조 + 정보 목록 + 링크" 형식이다.
// 링크가 들어가면 한글 45자를 넘으므로 장문(LMS)으로 나간다 (솔라피가 길이로 자동 판별).
// 보고 제목 등 업무 내용은 넣지 않는다 (PRD §5.4.1).

export type Stage = "prepare" | "imminent" | "call" | "change";

export interface SmsTemplate {
  name: string;
  /** 장문 문자 제목 (수신 화면 상단 굵은 글씨) */
  subject: string;
  /** 본문 첫 줄 강조 문구 */
  headline: string;
  /** 큰 번호 줄 */
  emphasis: string;
  body: string;
  linkLabel: string;
}

const INFO = `- 접수일: #{접수일시}
- 보고실: #{보고실}
- 위치: #{위치}
- 신청자: #{이름}`;

const FOOTER = "※ 강남구청 똑보(대면보고 대기) 안내 문자입니다.";

export const TEMPLATES: Record<Stage, SmsTemplate> = {
  prepare: {
    name: "준비 알림",
    subject: "[똑보] #{대기번호}번 곧 차례예요",
    headline: "현재 대기순서",
    emphasis: "#{대기번호}번",
    body: `${INFO}

내 앞에 #{앞건수}건 남았어요. (#{예상시간})
차례가 되면 다시 문자로 알려드려요.`,
    linkLabel: "실시간 대기순서",
  },
  imminent: {
    name: "임박 알림",
    subject: "[똑보] #{대기번호}번 다음 순서",
    headline: "곧 내 차례예요",
    emphasis: "#{대기번호}번 · 다음 순서",
    body: `${INFO}

다음 순서입니다. 보고실로 출발할 준비를 해 주세요.`,
    linkLabel: "실시간 대기순서",
  },
  call: {
    name: "호출(지금 입장)",
    subject: "[똑보] #{대기번호}번 지금 입장해 주세요",
    headline: "지금 입장해 주세요",
    emphasis: "#{대기번호}번 호출",
    body: `${INFO}

#{이름}님, 보고 차례입니다.
#{유예시간}분 안에 아래 링크로 응답해 주세요.`,
    linkLabel: "지금 응답하기",
  },
  change: {
    name: "대기 변경 안내",
    subject: "[똑보] #{대기번호}번 대기 변경 안내",
    headline: "대기 변경 안내",
    emphasis: "#{대기번호}번",
    body: `${INFO}

#{안내}`,
    linkLabel: "실시간 대기순서",
  },
};

export interface RenderedSms {
  subject: string;
  text: string;
  /** 미리보기 화면용 분해 값 */
  parts: { headline: string; emphasis: string; body: string; link: { label: string; url: string } | null; footer: string };
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/#\{([^}]+)\}/g, (_, k: string) => vars[k] ?? "");

export function renderSms(stage: Stage, vars: Record<string, string>, url: string | null): RenderedSms {
  const t = TEMPLATES[stage];
  const parts = {
    headline: fill(t.headline, vars),
    emphasis: fill(t.emphasis, vars),
    // 값이 비어 있는 정보 줄(예: 위치 미입력)은 뺀다.
    body: fill(t.body, vars).replace(/^- [^:\n]+: *\n/gm, ""),
    link: url ? { label: t.linkLabel, url } : null,
    footer: FOOTER,
  };
  const text = [
    `[똑보] ${parts.headline}`,
    `■ ${parts.emphasis}`,
    "",
    parts.body,
    ...(parts.link ? ["", `▶ ${parts.link.label}`, parts.link.url] : []),
    "",
    parts.footer,
  ].join("\n");
  return { subject: fill(t.subject, vars), text, parts };
}

/** "2026.11.03 (화) 오후 02:43" — 똑닥 안내와 같은 표기 */
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
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  // 오전/오후는 직접 붙인다. 실행 환경의 ICU에 따라 dayPeriod가 "PM"으로 나오기도 한다.
  const h = Number(parts.hour);
  const hour12 = String(h % 12 || 12).padStart(2, "0");
  return `${parts.year}.${parts.month}.${parts.day} (${parts.weekday}) ${h < 12 ? "오전" : "오후"} ${hour12}:${parts.minute}`;
}

/** +821012345678 → 01012345678 (국내 문자 발송 형식) */
export function toDomesticNumber(e164: string) {
  return e164.startsWith("+82") ? `0${e164.slice(3)}` : e164.replace(/\D/g, "");
}
