// 문자 발송 어댑터 (PRD §5.4.1). 운영은 솔라피, 개발은 콘솔 출력.
import { toDomesticNumber, type RenderedSms, type Stage } from "./templates";

export type { Stage } from "./templates";

export interface OutboundMessage {
  /** 중복 방지 키 (아웃박스 행 기준). 솔라피는 키를 받지 않아 아웃박스의 임대(lease)로 중복을 막는다. */
  idempotencyKey: string;
  to: string; // E.164 (+8210...)
  stage: Stage;
  sms: RenderedSms;
}

export type SendResult =
  /** 접수 완료. 최종 수신 결과는 상태 조회/웹훅으로 확인한다. */
  | { status: "sent"; providerMessageId: string }
  /** 동기 응답에서 바로 최종 결과가 나온 경우 */
  | { status: "delivered"; providerMessageId: string };

export type DeliveryState = { status: "pending" } | { status: "delivered" } | { status: "failed"; reason: string };

export interface MessagingProvider {
  name: string;
  send(msg: OutboundMessage): Promise<SendResult>;
  /** 접수된 메시지들의 수신 결과 조회 (웹훅을 받을 수 없는 내부망에서도 결과를 알 수 있게) */
  getStatuses?(providerMessageIds: string[]): Promise<Record<string, DeliveryState>>;
}

/** 개발용: 서버 로그에 문자 내용을 출력하고 도달로 처리한다. */
export const consoleProvider: MessagingProvider = {
  name: "console",
  async send(msg) {
    console.info(`[messaging:console] 문자 → ${toDomesticNumber(msg.to)} (제목: ${msg.sms.subject})\n${msg.sms.text}`);
    return { status: "delivered", providerMessageId: `console-${msg.idempotencyKey}` };
  },
};

/**
 * 솔라피 상태 코드 해석. 4000 = 수신 완료(공식 예제 "정상처리는 4000번").
 * 2000(접수)·3000(통신사 전송)만 진행 중으로 보고, 그 외 코드(3059 등)는 실패로 처리한다.
 */
export function solapiState(statusCode: string | null | undefined, reason?: string | null): DeliveryState {
  if (!statusCode) return { status: "pending" };
  if (statusCode === "4000") return { status: "delivered" };
  if (statusCode === "2000" || statusCode === "3000") return { status: "pending" };
  return { status: "failed", reason: `${statusCode}${reason ? ` ${reason}` : ""}` };
}

export function createSolapiProvider(env = process.env): MessagingProvider {
  const apiKey = env.SOLAPI_API_KEY;
  const apiSecret = env.SOLAPI_API_SECRET;
  const sender = env.SOLAPI_SENDER?.replace(/\D/g, "");
  if (!apiKey || !apiSecret || !sender) {
    throw new Error("솔라피 설정이 없습니다: SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER(등록된 발신번호)");
  }
  let client: import("solapi").SolapiMessageService | null = null;
  const service = async () => {
    if (!client) {
      const { SolapiMessageService } = await import("solapi");
      client = new SolapiMessageService(apiKey, apiSecret);
    }
    return client;
  };

  return {
    name: "solapi",
    async send(msg) {
      const s = await service();
      const res = await s.send(
        { to: toDomesticNumber(msg.to), from: sender, text: msg.sms.text, subject: msg.sms.subject },
        { showMessageList: true },
      );
      const failed = res.failedMessageList?.[0];
      if (failed) throw new Error(`솔라피 접수 실패 ${failed.statusCode} ${failed.statusMessage}`);
      const id = res.messageList?.[0]?.messageId;
      if (!id) throw new Error("솔라피 응답에 메시지 ID가 없습니다");
      return { status: "sent", providerMessageId: id };
    },
    async getStatuses(ids) {
      const s = await service();
      const res = await s.getMessages({ messageIds: ids, limit: ids.length });
      const out: Record<string, DeliveryState> = {};
      for (const [key, m] of Object.entries(res.messageList ?? {})) {
        out[m.messageId ?? key] = solapiState(m.statusCode, m.reason);
      }
      return out;
    },
  };
}

let cached: MessagingProvider | null = null;
export function getProvider(): MessagingProvider {
  if (cached) return cached;
  const name = process.env.MESSAGING_PROVIDER ?? "console";
  if (name === "console") return (cached = consoleProvider);
  if (name === "solapi") return (cached = createSolapiProvider());
  throw new Error(`MESSAGING_PROVIDER '${name}' 어댑터가 없습니다 (console | solapi).`);
}
