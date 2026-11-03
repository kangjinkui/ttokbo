export type Role = "staff" | "secretary" | "executive" | "admin" | "display";
export type RequestStatus = "waiting" | "called" | "in_progress" | "done" | "held" | "cancelled";
export type RoomStatus = "open" | "paused" | "external" | "closed";
export type CallResponse = "on_way" | "delay_5" | "defer" | "cancel";

export interface Actor {
  id: number;
  role: Role;
}

export const EXPECTED_MINUTES = [5, 10, 15, 20] as const;
export const MAX_DEFERS = 5;
export const MAX_DEFER_STEPS = 3;

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  open: "접수 가능",
  paused: "일시중지",
  external: "외부 일정",
  closed: "마감",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  waiting: "대기",
  called: "호출",
  in_progress: "보고 중",
  done: "완료",
  held: "보류",
  cancelled: "취소",
};

export class QueueError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** 트랜잭션이 끝난 뒤 실시간 갱신을 보낼 대상 */
export class Effects {
  rooms = new Set<number>();
  users = new Set<number>();
  /** 발송 워커를 바로 깨울지 여부 */
  outbox = false;
}
