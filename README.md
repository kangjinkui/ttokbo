# 똑보 (ttokbo) — 줄 없이 보고하기

강남구청 대면보고 대기 서비스. 직원은 자리에서 보고실 줄을 서고, 실시간 순번을 보다가 차례가 오면 앱·카카오 알림톡(실패 시 문자)으로 호출받는다.

| 경로 | 내용 |
|---|---|
| [`ttokbo/`](ttokbo/) | 앱 (Next.js 16, PostgreSQL/PGlite). 실행·구조는 [ttokbo/README.md](ttokbo/README.md) |
| [`스마트_보고대기_시스템_PRD_v2.md`](스마트_보고대기_시스템_PRD_v2.md) | 현재 요구사항 (v2.1) |
| [`스마트_보고대기_시스템_PRD_v1.md`](스마트_보고대기_시스템_PRD_v1.md) | 최초 요구사항 |

```bash
cd ttokbo
npm install
npm run dev   # http://localhost:3000
```
