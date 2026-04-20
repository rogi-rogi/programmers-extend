"use strict";

var SETTINGS_KEY_LEVEL_MINUTES = "recommendedMinutesByLevel";
var SETTINGS_KEY_SHOW_LEVEL_PREFIX = "showLevelPrefix";
var DEFAULT_SHOW_LEVEL_PREFIX = true;
var MIN_RECOMMENDED_MINUTES = 1;
var MAX_RECOMMENDED_MINUTES = 180;
var DEFAULT_LEVEL_MINUTES = [10, 15, 30, 50, 60, 80];
var lastSavedLevelMinutes = normalizeLevelMinutes({});
var statusClearTimeoutId = null;

/**
 * 목적: 도움말 툴팁의 X축은 화면 중앙, Y축은 아이콘 하단 3px로 배치한다.
 * 입력: 없음
 * 처리: 각 도움말 아이콘의 viewport 좌표를 읽어 대응 툴팁 top 값을 계산해 적용한다.
 * 반환/부작용: 없음, DOM style(top) 갱신 부작용 있음
 */
function positionHelpBubbles() {
  var wraps = document.querySelectorAll(".help-wrap");
  wraps.forEach(function (wrapEl) {
    var triggerEl = wrapEl.querySelector(".help-trigger");
    var bubbleEl = wrapEl.querySelector(".help-bubble");
    if (!triggerEl || !bubbleEl) {
      return;
    }

    var triggerRect = triggerEl.getBoundingClientRect();
    bubbleEl.style.top = String(Math.round(triggerRect.bottom + 3)) + "px";
  });
}

/**
 * 목적: 단일 분 값을 허용 범위 내 정수로 보정한다.
 * 입력: value(any), fallback(number) - 원본 값과 기본값
 * 처리: 숫자 변환 후 정수화 및 최소/최대 clamp를 수행한다.
 * 반환/부작용: number - 저장 가능한 분 값, 부작용 없음
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
 * 목적: 레벨별 설정 객체를 lv0~lv5 기준의 완전한 값으로 보정한다.
 * 입력: raw(any) - storage에서 읽은 레벨 설정 데이터
 * 처리: 각 레벨 값을 읽어 누락/비정상 값을 기본값으로 대체한다.
 * 반환/부작용: object - `0..5` 키를 가진 분 설정 객체, 부작용 없음
 */
function normalizeLevelMinutes(raw) {
  var result = {};
  var source = raw && typeof raw === "object" ? raw : {};

  for (var level = 0; level <= 5; level += 1) {
    result[level] = normalizeMinutes(source[level], DEFAULT_LEVEL_MINUTES[level]);
  }

  return result;
}

/**
 * 목적: 상태 텍스트 영역에 사용자 피드백을 표시한다.
 * 입력: message(string) - 사용자에게 보여줄 안내 문구
 * 처리: 상태 요소를 찾아 텍스트를 교체한다.
 * 반환/부작용: 없음, DOM 텍스트 업데이트 부작용 있음
 */
function setStatus(message) {
  var statusEl = document.getElementById("statusText");
  if (statusClearTimeoutId) {
    window.clearTimeout(statusClearTimeoutId);
    statusClearTimeoutId = null;
  }

  statusEl.textContent = message;

  if (message) {
    statusClearTimeoutId = window.setTimeout(function () {
      statusEl.textContent = "";
      statusClearTimeoutId = null;
    }, 3000);
  }
}

/**
 * 목적: 팝업 상단의 현재 레벨 안내 텍스트를 갱신한다.
 * 입력: message(string) - 사용자에게 보여줄 현재 레벨 안내 문구
 * 처리: currentLevelText 요소의 텍스트를 교체한다.
 * 반환/부작용: 없음, DOM 텍스트 업데이트 부작용 있음
 */
function setCurrentLevelText(message) {
  var levelTextEl = document.getElementById("currentLevelText");
  levelTextEl.textContent = message;
}

/**
 * 목적: 현재 입력된 레벨 시간값이 마지막 저장값과 다른지 판단한다.
 * 입력: 없음
 * 처리: 폼 값을 수집해 마지막 저장 스냅샷과 레벨별로 비교한다.
 * 반환/부작용: boolean - 저장 필요 여부, 부작용 없음
 */
function hasLevelMinutesChanges() {
  var current = collectLevelMinutesFromForm();

  for (var level = 0; level <= 5; level += 1) {
    if (current[level] !== lastSavedLevelMinutes[level]) {
      return true;
    }
  }

  return false;
}

/**
 * 목적: 저장 버튼의 활성/비활성 상태를 현재 변경 여부에 맞게 갱신한다.
 * 입력: 없음
 * 처리: 레벨 시간 변경 여부를 계산해 저장 버튼 disabled 속성을 갱신한다.
 * 반환/부작용: 없음, DOM 속성 변경 부작용 있음
 */
function updateSaveButtonState() {
  var saveButtonEl = document.getElementById("saveButton");
  saveButtonEl.disabled = !hasLevelMinutesChanges();
}

/**
 * 목적: 레벨 하이라이트 클래스를 모두 제거한다.
 * 입력: 없음
 * 처리: 레벨 행 요소를 순회하며 활성 표시 클래스를 삭제한다.
 * 반환/부작용: 없음, DOM 클래스 변경 부작용 있음
 */
function clearCurrentLevelHighlight() {
  var levelRows = document.querySelectorAll(".level-row");
  levelRows.forEach(function (rowEl) {
    rowEl.classList.remove("is-current");
  });
}

/**
 * 목적: 지정한 레벨 행에 현재 레벨 하이라이트를 적용한다.
 * 입력: level(number) - 0~5 범위의 현재 문제 레벨
 * 처리: 해당 data-level 행을 찾아 활성 표시 클래스를 추가한다.
 * 반환/부작용: 없음, DOM 클래스 변경 부작용 있음
 */
function highlightCurrentLevel(level) {
  clearCurrentLevelHighlight();

  var rowEl = document.querySelector('.level-row[data-level="' + level + '"]');
  if (rowEl) {
    rowEl.classList.add("is-current");
  }
}

/**
 * 목적: 활성 탭 콘텐츠 스크립트에 현재 문제 레벨을 요청해 하이라이트한다.
 * 입력: 없음
 * 처리: active tab에 메시지를 보내 레벨 응답이 오면 해당 행을 강조한다.
 * 반환/부작용: 없음, 탭 조회/메시지 전송/DOM 클래스 변경 부작용 있음
 */
function requestCurrentLevelHighlight() {
  setCurrentLevelText("현재 레벨: 확인 중...");
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (chrome.runtime.lastError || !tabs || !tabs[0] || !tabs[0].id) {
      setCurrentLevelText("현재 레벨: 확인 불가");
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { type: "GET_CURRENT_CHALLENGE_LEVEL" }, function (response) {
      if (chrome.runtime.lastError || !response || typeof response.level !== "number") {
        clearCurrentLevelHighlight();
        setCurrentLevelText("현재 레벨: 확인 불가");
        return;
      }

      var level = Math.max(0, Math.min(5, Math.floor(response.level)));
      highlightCurrentLevel(level);
      setCurrentLevelText("현재 레벨: Lv. " + level);
    });
  });
}

/**
 * 목적: 저장된 설정을 읽어 입력 폼과 토글 상태에 반영한다.
 * 입력: 없음
 * 처리: storage.sync에서 설정을 조회하고 lv0~lv5 입력값 및 토글을 채운다.
 * 반환/부작용: 없음, 비동기 storage 조회 및 DOM 업데이트 부작용 있음
 */
function loadSettingsIntoForm() {
  chrome.storage.sync.get([SETTINGS_KEY_LEVEL_MINUTES, SETTINGS_KEY_SHOW_LEVEL_PREFIX], function (result) {
    var normalized = normalizeLevelMinutes(result && result[SETTINGS_KEY_LEVEL_MINUTES]);
    var showLevelPrefix = normalizeShowLevelPrefix(result && result[SETTINGS_KEY_SHOW_LEVEL_PREFIX]);

    for (var level = 0; level <= 5; level += 1) {
      var inputEl = document.getElementById("minutesLv" + level);
      inputEl.value = String(normalized[level]);
    }

    var toggleEl = document.getElementById("levelPrefixToggle");
    toggleEl.checked = showLevelPrefix;

    lastSavedLevelMinutes = normalized;
    updateSaveButtonState();
  });
}

/**
 * 목적: 입력 폼의 lv0~lv5 값을 수집해 보정된 설정 객체를 만든다.
 * 입력: 없음
 * 처리: 각 입력값을 읽고 숫자 보정 로직으로 정규화한다.
 * 반환/부작용: object - 저장 가능한 레벨별 분 설정, 부작용 없음
 */
function collectLevelMinutesFromForm() {
  var levelMinutes = {};

  for (var level = 0; level <= 5; level += 1) {
    var inputEl = document.getElementById("minutesLv" + level);
    levelMinutes[level] = normalizeMinutes(inputEl.value, DEFAULT_LEVEL_MINUTES[level]);
  }

  return levelMinutes;
}

/**
 * 목적: 폼의 레벨별 시간 설정값을 저장소에 반영한다.
 * 입력: 없음
 * 처리: 입력값을 보정 후 storage.sync에 저장하고 완료 메시지를 출력한다.
 * 반환/부작용: 없음, 비동기 storage 저장 및 DOM 업데이트 부작용 있음
 */
function saveSettingsFromForm() {
  var levelMinutes = collectLevelMinutesFromForm();

  chrome.storage.sync.set(
    (function () {
      var payload = {};
      payload[SETTINGS_KEY_LEVEL_MINUTES] = levelMinutes;
      return payload;
    })(),
    function () {
      for (var level = 0; level <= 5; level += 1) {
        var inputEl = document.getElementById("minutesLv" + level);
        inputEl.value = String(levelMinutes[level]);
      }
      lastSavedLevelMinutes = levelMinutes;
      updateSaveButtonState();
      setStatus("저장되었습니다.");
    }
  );
}

/**
 * 목적: 난이도 접두사 토글 값을 즉시 저장한다.
 * 입력: checked(boolean) - 토글 on/off 상태
 * 처리: storage.sync에 토글 값을 즉시 반영하고 상태 메시지를 갱신한다.
 * 반환/부작용: 없음, 비동기 storage 저장 및 DOM 텍스트 업데이트 부작용 있음
 */
function saveLevelPrefixToggleImmediately(checked) {
  chrome.storage.sync.set(
    (function () {
      var payload = {};
      payload[SETTINGS_KEY_SHOW_LEVEL_PREFIX] = !!checked;
      return payload;
    })(),
    function () {
      setStatus("난이도 표시 설정이 저장되었습니다.");
    }
  );
}

/**
 * 목적: 팝업 UI 이벤트 핸들러를 연결한다.
 * 입력: 없음
 * 처리: 저장 버튼/토글/입력 변경 이벤트를 등록하고 초기값을 로드한다.
 * 반환/부작용: 없음, DOM 이벤트 등록 및 storage 조회 부작용 있음
 */
function initializePopup() {
  var saveButtonEl = document.getElementById("saveButton");
  var toggleEl = document.getElementById("levelPrefixToggle");
  var helpTriggers = document.querySelectorAll(".help-trigger");

  saveButtonEl.addEventListener("click", saveSettingsFromForm);
  toggleEl.addEventListener("change", function () {
    saveLevelPrefixToggleImmediately(toggleEl.checked);
  });
  helpTriggers.forEach(function (triggerEl) {
    triggerEl.addEventListener("mouseenter", positionHelpBubbles);
    triggerEl.addEventListener("focus", positionHelpBubbles);
  });
  window.addEventListener("resize", positionHelpBubbles);

  for (var level = 0; level <= 5; level += 1) {
    (function (capturedLevel) {
      var inputEl = document.getElementById("minutesLv" + capturedLevel);
      inputEl.addEventListener("input", updateSaveButtonState);
      inputEl.addEventListener("change", updateSaveButtonState);
    })(level);
  }

  loadSettingsIntoForm();
  requestCurrentLevelHighlight();
  positionHelpBubbles();
}

document.addEventListener("DOMContentLoaded", initializePopup, { once: true });
