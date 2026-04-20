(function () {
  "use strict";

  var SETTINGS_KEY_LEVEL_MINUTES = "recommendedMinutesByLevel";
  var SETTINGS_KEY_SHOW_LEVEL_PREFIX = "showLevelPrefix";
  var SETTINGS_KEY_LEGACY_MINUTES = "recommendedMinutesPerLevel";
  var DEFAULT_SHOW_LEVEL_PREFIX = true;
  var MIN_RECOMMENDED_MINUTES = 1;
  var MAX_RECOMMENDED_MINUTES = 180;
  var DEFAULT_LEVEL_MINUTES = [10, 15, 30, 50, 60, 80];

  var lessonStartedAtMs = Date.now();
  var currentChallengeLevel = null;

  /**
   * 목적: 단일 분 값을 허용 범위 내 정수로 보정한다.
   * 입력: value(any), fallback(number) - 원본 값과 기본값
   * 처리: 숫자 변환 후 정수화 및 최소/최대 clamp를 수행한다.
   * 반환/부작용: number - 유효한 분 값, 부작용 없음
   */
  function normalizeMinutes(value, fallback) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(MIN_RECOMMENDED_MINUTES, Math.min(MAX_RECOMMENDED_MINUTES, Math.floor(parsed)));
  }

  /**
   * 목적: 난이도 접두사 표시 설정값을 boolean으로 보정한다.
   * 입력: value(any) - 저장소에서 읽은 토글 값
   * 처리: boolean 타입이면 그대로 사용하고 아니면 기본값을 적용한다.
   * 반환/부작용: boolean - 접두사 표시 활성화 여부, 부작용 없음
   */
  function normalizeShowLevelPrefix(value) {
    return typeof value === "boolean" ? value : DEFAULT_SHOW_LEVEL_PREFIX;
  }

  /**
   * 목적: 레벨별 설정 데이터를 lv0~lv5 기준으로 보정한다.
   * 입력: levelMinutesRaw(any), legacyMinutes(any) - 레벨별 저장값과 구버전 단일값
   * 처리: 레벨별 값을 우선 사용하고, 없으면 구버전 단일값 또는 기본값으로 채운다.
   * 반환/부작용: object - 0..5 레벨 분 설정 객체, 부작용 없음
   */
  function normalizeLevelMinutes(levelMinutesRaw, legacyMinutes) {
    var result = {};
    var source = levelMinutesRaw && typeof levelMinutesRaw === "object" ? levelMinutesRaw : {};
    var normalizedLegacy = normalizeMinutes(legacyMinutes, NaN);

    for (var level = 0; level <= 5; level += 1) {
      var fallback = Number.isFinite(normalizedLegacy) ? normalizedLegacy : DEFAULT_LEVEL_MINUTES[level];
      result[level] = normalizeMinutes(source[level], fallback);
    }

    return result;
  }

  /**
   * 목적: 누적 초를 HH:MM:SS 문자열로 변환한다.
   * 입력: seconds(number) - 0 이상의 경과 초
   * 처리: 시/분/초를 계산하고 2자리로 패딩한다.
   * 반환/부작용: string - 화면 출력용 시간 문자열, 부작용 없음
   */
  function formatElapsedTime(seconds) {
    var safeSeconds = Math.max(0, Math.floor(seconds));
    var hours = Math.floor(safeSeconds / 3600);
    var minutes = Math.floor((safeSeconds % 3600) / 60);
    var secs = safeSeconds % 60;

    return [hours, minutes, secs]
      .map(function (value) {
        return String(value).padStart(2, "0");
      })
      .join(":");
  }

  /**
   * 목적: 확장 저장소에서 알림/제목 표시 관련 설정값을 읽는다.
   * 입력: onLoaded(function) - 설정 객체 수신 콜백
   * 처리: 신버전/구버전 키를 조회해 보정된 설정 객체로 변환한다.
   * 반환/부작용: 없음, 비동기 storage 조회 부작용 있음
   */
  function loadAllSettings(onLoaded) {
    chrome.storage.sync.get(
      [SETTINGS_KEY_LEVEL_MINUTES, SETTINGS_KEY_LEGACY_MINUTES, SETTINGS_KEY_SHOW_LEVEL_PREFIX],
      function (result) {
        var levelMinutesRaw = result && result[SETTINGS_KEY_LEVEL_MINUTES];
        var legacyMinutes = result && result[SETTINGS_KEY_LEGACY_MINUTES];
        var showLevelPrefix = normalizeShowLevelPrefix(result && result[SETTINGS_KEY_SHOW_LEVEL_PREFIX]);

        onLoaded({
          levelMinutes: normalizeLevelMinutes(levelMinutesRaw, legacyMinutes),
          showLevelPrefix: showLevelPrefix
        });
      }
    );
  }

  /**
   * 목적: 난이도별 설정 객체에서 해당 레벨 분 값을 조회한다.
   * 입력: challengeLevel(number), levelMinutes(object)
   * 처리: 레벨 값을 기준으로 설정 객체를 조회하고 누락 시 기본값을 사용한다.
   * 반환/부작용: number - 해당 레벨 설정 분 값, 부작용 없음
   */
  function resolveMinutesForLevel(challengeLevel, levelMinutes) {
    return normalizeMinutes(levelMinutes[challengeLevel], DEFAULT_LEVEL_MINUTES[challengeLevel]);
  }

  /**
   * 목적: 제목 접두사에서 레벨 표기(`Lv N. `)를 제거한다.
   * 입력: text(string) - 기존 제목 텍스트
   * 처리: 접두사 패턴 정규식을 적용해 제거한다.
   * 반환/부작용: string - 접두사 제거된 제목, 부작용 없음
   */
  function stripLevelPrefix(text) {
    return String(text || "").replace(/^Lv\s*\d+\.\s*/, "");
  }

  /**
   * 목적: challenge-title 텍스트에 레벨 접두사를 적용/해제한다.
   * 입력: level(number), enabled(boolean) - 현재 레벨과 토글 상태
   * 처리: 원본 제목을 데이터 속성에 보관하고 토글 상태에 따라 텍스트를 갱신한다.
   * 반환/부작용: boolean - 적용 성공 여부, DOM 텍스트 변경 부작용 있음
   */
  function applyLevelPrefixToChallengeTitle(level, enabled) {
    var titleEl = document.querySelector(".challenge-title");
    if (!titleEl) {
      return false;
    }

    var storedOriginal = titleEl.getAttribute("data-pe-original-title");
    if (!storedOriginal) {
      storedOriginal = stripLevelPrefix(titleEl.textContent).trim();
      titleEl.setAttribute("data-pe-original-title", storedOriginal);
    }

    titleEl.textContent = enabled ? "Lv " + level + ". " + storedOriginal : storedOriginal;
    return true;
  }

  /**
   * 목적: challenge-title이 늦게 렌더링돼도 레벨 접두사를 적용/해제한다.
   * 입력: level(number), enabled(boolean) - 현재 레벨과 토글 상태
   * 처리: 즉시 적용 시도 후 실패하면 MutationObserver로 대기해 적용한다.
   * 반환/부작용: 없음, DOM 관찰자 등록/해제 및 텍스트 변경 부작용 있음
   */
  function applyLevelPrefixWhenReady(level, enabled) {
    if (applyLevelPrefixToChallengeTitle(level, enabled)) {
      return;
    }

    var observer = new MutationObserver(function () {
      if (applyLevelPrefixToChallengeTitle(level, enabled)) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
      }
    });

    var timeoutId = window.setTimeout(function () {
      observer.disconnect();
    }, 15000);

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /**
   * 목적: 타이머 위젯 루트 요소를 생성해 문서에 삽입한다.
   * 입력: 없음
   * 처리: 위젯 컨테이너/레이블/값 요소를 만들고 body에 append 한다.
   * 반환/부작용: HTMLElement - 시간 값 표시 요소를 반환, DOM 변경 부작용 있음
   */
  function createTimerWidget() {
    var existing = document.getElementById("pe-timer-root");
    if (existing) {
      return existing.querySelector("#pe-timer-value");
    }

    var root = document.createElement("div");
    root.id = "pe-timer-root";

    var label = document.createElement("div");
    label.id = "pe-timer-label";
    label.textContent = "풀이 시간";

    var value = document.createElement("div");
    value.id = "pe-timer-value";
    value.textContent = "00:00:00";

    root.appendChild(label);
    root.appendChild(value);
    document.body.appendChild(root);

    return value;
  }

  /**
   * 목적: 1초 단위로 경과 시간을 갱신하는 타이머를 시작한다.
   * 입력: 없음
   * 처리: 시작 시각을 기준으로 setInterval로 위젯 텍스트를 갱신한다.
   * 반환/부작용: 없음, 주기 타이머 및 DOM 텍스트 업데이트 부작용 있음
   */
  function startLessonTimer() {
    var timerValueEl = createTimerWidget();

    function render() {
      var elapsedSeconds = Math.floor((Date.now() - lessonStartedAtMs) / 1000);
      timerValueEl.textContent = formatElapsedTime(elapsedSeconds);
    }

    render();
    window.setInterval(render, 1000);
  }

  /**
   * 목적: 난이도 속성을 가진 요소가 준비될 때까지 대기 후 콜백을 호출한다.
   * 입력: timeoutMs(number), onFound(function) - 제한시간과 결과 콜백
   * 처리: 즉시 조회 후 없으면 MutationObserver로 감시하고 타임아웃 시 null 반환한다.
   * 반환/부작용: 없음, DOM 관찰자 등록/해제 부작용 있음
   */
  function waitForChallengeLevelElement(timeoutMs, onFound) {
    function findLevelElement() {
      return document.querySelector(".lesson-content[data-challenge-level]") || document.querySelector("[data-challenge-level]");
    }

    var immediate = findLevelElement();
    if (immediate) {
      onFound(immediate);
      return;
    }

    var observer = new MutationObserver(function () {
      var target = findLevelElement();
      if (target) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
        onFound(target);
      }
    });

    var timeoutId = window.setTimeout(function () {
      observer.disconnect();
      onFound(null);
    }, timeoutMs);

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /**
   * 목적: 요소의 data-challenge-level 값을 0~5 난이도로 파싱한다.
   * 입력: element(Element|null) - 난이도 속성 조회 대상 요소
   * 처리: 문자열에서 숫자를 추출해 정수 변환 후 0~5 범위로 보정한다.
   * 반환/부작용: number|null - 유효 난이도(0~5) 또는 null, 부작용 없음
   */
  function parseChallengeLevel(element) {
    if (!element) {
      return null;
    }

    var levelRaw = String(element.getAttribute("data-challenge-level") || "").trim();
    var digitMatch = levelRaw.match(/\d+/);
    var parsed = Number(digitMatch ? digitMatch[0] : levelRaw);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    var normalizedLevel = Math.floor(parsed);
    if (normalizedLevel < 0) {
      return null;
    }

    return Math.min(5, normalizedLevel);
  }

  /**
   * 목적: 백그라운드에 목표시간 알림 예약(또는 즉시 알림)을 요청한다.
   * 입력: challengeLevel(number), configuredMinutes(number)
   * 처리: 경과시간을 반영해 남은시간을 계산하고 런타임 메시지를 전송한다.
   * 반환/부작용: 없음, 확장 런타임 메시지 전송 부작용 있음
   */
  function scheduleRecommendedTimeNotice(challengeLevel, configuredMinutes) {
    var totalMinutes = configuredMinutes;
    var totalMs = totalMinutes * 60 * 1000;
    var elapsedMs = Math.max(0, Date.now() - lessonStartedAtMs);
    var remainingMs = Math.max(0, totalMs - elapsedMs);

    chrome.runtime.sendMessage(
      {
        type: "SCHEDULE_RECOMMENDED_TIME_NOTICE",
        challengeLevel: challengeLevel,
        configuredMinutes: configuredMinutes,
        totalMinutes: totalMinutes,
        lessonPath: window.location.pathname,
        remainingMs: remainingMs
      },
      function () {
        if (chrome.runtime.lastError) {
          console.warn("[Programmers Extend] failed to schedule notification", chrome.runtime.lastError.message);
        }
      }
    );
  }

  /**
   * 목적: 현재 난이도 기준으로 설정을 적용해 알림 예약을 갱신한다.
   * 입력: levelMinutes(object) - 레벨별 분 설정
   * 처리: 현재 난이도가 있으면 해당 레벨 분 값으로 경과시간 반영 재예약을 전송한다.
   * 반환/부작용: 없음, 런타임 메시지 전송 부작용 있음
   */
  function rescheduleNoticeWithSettings(levelMinutes) {
    if (currentChallengeLevel === null) {
      return;
    }

    var configuredMinutes = resolveMinutesForLevel(currentChallengeLevel, levelMinutes);
    scheduleRecommendedTimeNotice(currentChallengeLevel, configuredMinutes);
  }

  /**
   * 목적: 설정값 변경 이벤트를 감지해 알림 재예약과 제목 접두사 반영을 수행한다.
   * 입력: 없음
   * 처리: 저장소 변경을 구독하고 레벨/토글 변경에 따라 재예약 및 제목 업데이트를 수행한다.
   * 반환/부작용: 없음, 저장소 이벤트 구독/메시지 전송/DOM 텍스트 변경 부작용 있음
   */
  function attachSettingsChangeListener() {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "sync") {
        return;
      }

      if (!changes[SETTINGS_KEY_LEVEL_MINUTES] && !changes[SETTINGS_KEY_LEGACY_MINUTES] && !changes[SETTINGS_KEY_SHOW_LEVEL_PREFIX]) {
        return;
      }

      loadAllSettings(function (settings) {
        if (currentChallengeLevel !== null) {
          rescheduleNoticeWithSettings(settings.levelMinutes);
          applyLevelPrefixWhenReady(currentChallengeLevel, settings.showLevelPrefix);
        }
      });
    });
  }

  /**
   * 목적: 타이머 표시와 목표시간 알림 예약을 통합 초기화한다.
   * 입력: 없음
   * 처리: 타이머를 시작하고 난이도/설정을 로딩해 알림 예약/접두사 반영/리스너 등록을 수행한다.
   * 반환/부작용: 없음, DOM/저장소/타이머/메시지 관련 부작용 있음
   */
  function initializeLessonPageFeatures() {
    startLessonTimer();
    attachSettingsChangeListener();

    waitForChallengeLevelElement(60000, function (levelElement) {
      currentChallengeLevel = parseChallengeLevel(levelElement);
      if (currentChallengeLevel === null) {
        console.warn("[Programmers Extend] data-challenge-level not found or invalid.");
        return;
      }

      loadAllSettings(function (settings) {
        var configuredMinutes = resolveMinutesForLevel(currentChallengeLevel, settings.levelMinutes);
        scheduleRecommendedTimeNotice(currentChallengeLevel, configuredMinutes);
        applyLevelPrefixWhenReady(currentChallengeLevel, settings.showLevelPrefix);
      });
    });
  }

  /**
   * 목적: 팝업에서 요청한 현재 문제 레벨 조회 메시지를 처리한다.
   * 입력: message(object), sender(object), sendResponse(function)
   * 처리: 현재 메모리 레벨 또는 DOM 파싱값을 계산해 응답한다.
   * 반환/부작용: boolean - 동기 응답만 사용하며 부작용 없음
   */
  function handlePopupMessage(message, sender, sendResponse) {
    if (!message || message.type !== "GET_CURRENT_CHALLENGE_LEVEL") {
      return false;
    }

    var level = currentChallengeLevel;
    if (level === null) {
      var levelElement = document.querySelector(".lesson-content[data-challenge-level]") || document.querySelector("[data-challenge-level]");
      level = parseChallengeLevel(levelElement);
    }

    sendResponse({ level: level });
    return false;
  }

  chrome.runtime.onMessage.addListener(handlePopupMessage);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLessonPageFeatures, { once: true });
  } else {
    initializeLessonPageFeatures();
  }
})();
