"use strict";

var ALARM_NAME_PREFIX = "pe-recommended:";
var PAYLOAD_KEY_PREFIX = "pe-alarm-payload:";

/**
 * 목적: 숫자 입력을 양의 정수로 보정하고 실패 시 기본값을 반환한다.
 * 입력: value(any), fallback(number) - 원본 값과 기본값
 * 처리: 숫자 변환 후 유효성 검사 및 1 이상 정수로 변환한다.
 * 반환/부작용: number - 보정된 양의 정수, 부작용 없음
 */
function normalizePositiveInt(value, fallback) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

/**
 * 목적: 남은 대기시간(ms)을 0 이상의 정수로 보정한다.
 * 입력: value(any), fallback(number) - 원본 값과 기본값
 * 처리: 숫자 변환 후 음수 방지 보정 및 정수화를 수행한다.
 * 반환/부작용: number - 알람 예약에 사용할 남은 밀리초, 부작용 없음
 */
function normalizeRemainingMs(value, fallback) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(parsed));
}

/**
 * 목적: lessonPath를 알람 이름에 안전한 문자열로 변환한다.
 * 입력: lessonPath(string|undefined) - 콘텐츠 스크립트에서 전달한 경로
 * 처리: 경로를 인코딩하고 누락 시 기본 식별자를 사용한다.
 * 반환/부작용: string - 알람 이름에 포함 가능한 경로 토큰, 부작용 없음
 */
function toSafePathToken(lessonPath) {
  var rawPath = typeof lessonPath === "string" && lessonPath ? lessonPath : "unknown";
  return encodeURIComponent(rawPath);
}

/**
 * 목적: 탭/문제 단위의 고유 알람 이름을 생성한다.
 * 입력: tabId(number|undefined), lessonPath(string|undefined)
 * 처리: prefix + tabId + 인코딩 경로를 결합해 고유 키를 만든다.
 * 반환/부작용: string - 알람 고유 이름, 부작용 없음
 */
function buildAlarmName(tabId, lessonPath) {
  var safeTabId = Number.isFinite(tabId) ? tabId : 0;
  return ALARM_NAME_PREFIX + safeTabId + ":" + toSafePathToken(lessonPath);
}

/**
 * 목적: 알림 메시지를 읽기 쉬운 한국어 문장으로 생성한다.
 * 입력: payload(object) - 설정 시간 정보를 담은 메시지 데이터
 * 처리: 설정 시간 값을 보정해 안내 문구를 조합한다.
 * 반환/부작용: string - 브라우저 알림 본문 텍스트, 부작용 없음
 */
function buildNotificationMessage(payload) {
  var configuredMinutes = normalizePositiveInt(payload.configuredMinutes, 10);
  return "목표 풀이 시간이 지났습니다. (" + configuredMinutes + "분)";
}

/**
 * 목적: 크롬 알림 API를 통해 목표시간 초과 알림을 표시한다.
 * 입력: payload(object) - 알림 문구에 필요한 데이터
 * 처리: 고유 ID를 만들고 notifications.create로 알림을 생성한다.
 * 반환/부작용: 없음, 시스템 알림 표시 부작용 있음
 */
function showRecommendedTimeNotification(payload) {
  var notificationId = "pe-recommended-time-" + Date.now();
  chrome.notifications.create(
    notificationId,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title: "Programmers Extend",
      message: buildNotificationMessage(payload)
    },
    function () {
      if (chrome.runtime.lastError) {
        console.warn("[Programmers Extend] notification create failed:", chrome.runtime.lastError.message);
      }
    }
  );
}

/**
 * 목적: 알람 트리거 시 저장된 payload로 알림을 생성하고 정리한다.
 * 입력: alarmName(string) - 발생한 알람의 고유 이름
 * 처리: storage.local에서 payload를 읽어 알림을 띄우고 해당 키를 삭제한다.
 * 반환/부작용: 없음, storage 조회/삭제 및 시스템 알림 부작용 있음
 */
function triggerAlarmNotification(alarmName) {
  var payloadKey = PAYLOAD_KEY_PREFIX + alarmName;

  chrome.storage.local.get([payloadKey], function (result) {
    var payload = result && result[payloadKey];
    if (payload) {
      showRecommendedTimeNotification(payload);
      chrome.storage.local.remove(payloadKey);
    }
  });
}

/**
 * 목적: 콘텐츠 스크립트 요청으로 목표시간 알림 알람을 예약한다.
 * 입력: message(object), sender(object) - 예약 데이터와 발신자 정보
 * 처리: 탭/문제 키로 기존 알람을 교체하고 남은시간 기준으로 알람을 재예약한다.
 * 반환/부작용: 없음, alarms/storage 쓰기 부작용 있음
 */
function scheduleRecommendedAlarm(message, sender) {
  var tabId = sender && sender.tab ? sender.tab.id : 0;
  var alarmName = buildAlarmName(tabId, message.lessonPath);
  var configuredMinutes = normalizePositiveInt(message.configuredMinutes, 10);
  var fallbackRemainingMs = configuredMinutes * 60 * 1000;
  var remainingMs = normalizeRemainingMs(message.remainingMs, fallbackRemainingMs);
  var payloadKey = PAYLOAD_KEY_PREFIX + alarmName;
  var triggerAtMs = Date.now() + remainingMs;

  chrome.alarms.clear(alarmName, function () {
    if (remainingMs <= 0) {
      showRecommendedTimeNotification({
        configuredMinutes: configuredMinutes
      });
      chrome.storage.local.remove(payloadKey);
      return;
    }

    chrome.alarms.create(alarmName, { when: triggerAtMs });

    var payload = {};
    payload[payloadKey] = {
      configuredMinutes: configuredMinutes
    };

    chrome.storage.local.set(payload);
  });
}

/**
 * 목적: 콘텐츠 스크립트 메시지를 분기해 알람 예약을 수행한다.
 * 입력: message(object), sender(object), sendResponse(function)
 * 처리: 메시지 타입을 검사해 예약 함수를 실행하고 응답 상태를 돌려준다.
 * 반환/부작용: boolean - 동기 응답 완료, alarms/storage 쓰기 부작용 있음
 */
function handleRuntimeMessage(message, sender, sendResponse) {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "SCHEDULE_RECOMMENDED_TIME_NOTICE") {
    scheduleRecommendedAlarm(message, sender);
    sendResponse({ ok: true });
    return false;
  }

  return false;
}

/**
 * 목적: 생성된 알람 이벤트를 수신해 목표시간 알림을 표시한다.
 * 입력: alarm(object) - 발생한 알람 정보
 * 처리: 알람 이름 prefix를 확인한 뒤 payload 조회 및 알림 표시를 호출한다.
 * 반환/부작용: 없음, storage 조회/삭제 및 알림 표시 부작용 있음
 */
function handleAlarm(alarm) {
  if (!alarm || typeof alarm.name !== "string") {
    return;
  }

  if (!alarm.name.startsWith(ALARM_NAME_PREFIX)) {
    return;
  }

  triggerAlarmNotification(alarm.name);
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);
chrome.alarms.onAlarm.addListener(handleAlarm);
