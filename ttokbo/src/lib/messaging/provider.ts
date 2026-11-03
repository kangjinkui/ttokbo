// 카카오 알림톡 + SMS 대체발송 대행사 어댑터 (PRD §5.4.1).
// 대행사가 정해지면 이 인터페이스를 구현한 어댑터 하나를 추가하고 MESSAGING_PROVIDER로 고른다.
import type { RenderedAlimtalk, Stage } from "./templates";

export type { Stage } from "./templates";

export interface OutboundMessage {
  /** 중복 발송 방지 키. 대행사가 지원하면 그대로 전달한다. */
  idempotencyKey: string;
  to: string; // E.164 (+8210...)
  stage: Stage;
  /** 검수된 템플릿에 값을 채운 결과. 대행사에는 templateCode + 치환된 본문·강조표기·버튼을 보낸다. */
  alimtalk: RenderedAlimtalk;
  /** 템플릿 변수 원본 (대행사가 변수 방식으로 받는 경우) */
  vars: Record<string, string>;
}

export type SendResult =
  /** 대행사 접수 완료. 최종 결과는 웹훅으로 온다. */
  | { status: "sent"; providerMessageId: string }
  /** 동기 응답에서 바로 최종 결과가 나온 경우 */
  | { status: "delivered" | "fallback_sms"; providerMessageId: string };

export interface MessagingProvider {
  name: string;
  send(msg: OutboundMessage): Promise<SendResult>;
}

/** 대행사 계약 전 개발용: 콘솔에 출력하고 도달로 처리한다. MOCK_KAKAO_FAIL=1이면 SMS 대체발송을 흉내 낸다. */
export const consoleProvider: MessagingProvider = {
  name: "console",
  async send(msg) {
    const fallback = process.env.MOCK_KAKAO_FAIL === "1";
    const a = msg.alimtalk;
    console.info(
      fallback
        ? `[messaging:console] SMS(대체) → ${msg.to}\n${a.smsText}`
        : `[messaging:console] 알림톡 → ${msg.to} [${a.templateCode}]\n${a.emphasisSubtitle}\n${a.emphasisTitle}\n\n${a.text}` +
            (a.button ? `\n[${a.button.name}] ${a.button.url}` : ""),
    );
    return { status: fallback ? "fallback_sms" : "delivered", providerMessageId: `console-${msg.idempotencyKey}` };
  },
};

export function getProvider(): MessagingProvider {
  const name = process.env.MESSAGING_PROVIDER ?? "console";
  if (name === "console") return consoleProvider;
  throw new Error(`MESSAGING_PROVIDER '${name}' 어댑터가 없습니다. src/lib/messaging/provider.ts에 추가하세요.`);
}
