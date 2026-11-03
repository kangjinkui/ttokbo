// 솔라피 설정 확인용: .env.local의 SMS_TEST_TO로 시험 문자 1건을 보내고 수신 결과를 확인한다.
// 실행: npm run sms:test
import { SolapiMessageService } from "solapi";

const { SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER, SMS_TEST_TO } = process.env;
const digits = (s) => s.replace(/\D/g, "");

/** 접수 실패 사유를 사람이 읽을 수 있게 */
function describeFailures(list) {
  return (list ?? []).map((f) => `  - ${f.statusCode} ${f.statusMessage} (수신 ${f.to}, 발신 ${f.from})`).join("\n");
}

async function main() {
  const missing = Object.entries({ SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER, SMS_TEST_TO })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`.env.local에 값이 없습니다: ${missing.join(", ")}`);
    return 1;
  }

  const svc = new SolapiMessageService(SOLAPI_API_KEY, SOLAPI_API_SECRET);
  let res;
  try {
    res = await svc.send(
      { to: digits(SMS_TEST_TO), from: digits(SOLAPI_SENDER), text: "[똑보] 문자 발송 시험입니다. 이 문자가 보이면 설정이 정상입니다." },
      { showMessageList: true },
    );
  } catch (err) {
    console.error("발송 오류:", err?.message ?? err);
    if (err?.failedMessageList?.length) console.error("실패 사유:\n" + describeFailures(err.failedMessageList));
    return 1;
  }

  if (res.failedMessageList?.length) {
    console.error("접수 실패:\n" + describeFailures(res.failedMessageList));
    return 1;
  }
  const id = res.messageList?.[0]?.messageId;
  console.log(`접수 완료 (메시지 ID ${id}). 수신 결과 확인 중…`);
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const m = Object.values((await svc.getMessages({ messageId: id })).messageList ?? {})[0];
    const code = m?.statusCode;
    if (code === "4000") {
      console.log("✓ 수신 완료 (4000). 휴대폰을 확인하세요.");
      return 0;
    }
    if (code && code !== "2000" && code !== "3000") {
      console.error(`✗ 발송 실패: ${code} ${m?.reason ?? ""}`);
      return 1;
    }
    console.log(`  상태 ${code ?? "확인 중"}…`);
  }
  console.log("1분 안에 최종 결과가 오지 않았습니다. 휴대폰과 솔라피 콘솔 발송내역을 확인하세요.");
  return 0;
}

// process.exit()을 바로 부르면 Windows에서 "Assertion failed … async.c" 메시지가 나와 exitCode로 끝낸다.
process.exitCode = await main();
