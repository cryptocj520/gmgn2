import { DATA_SCHEMA_VERSION, LIMITS } from "./constants.js";
import { parseMetricNumber } from "./token.js";

const ALERT_FILTERS = [
  ["minLiquidity", "liquidity"],
  ["minHolders", "holders"],
  ["minMarketCap", "marketCap"],
];

function passesAlertFilters(token, options) {
  return ALERT_FILTERS.every(([setting, metric]) => {
    const minimum = Number(options[setting]) || 0;
    return minimum <= 0 || (parseMetricNumber(token[metric]) ?? -1) >= minimum;
  });
}

export function compactTokenRecord(token) {
  // 已见表只保留结构化字段；原始行和重复指标留在有上限的提醒事件中。
  const { snapshot, metrics, capturedAt, ...record } = token;
  return record;
}

function sameRecord(left, right) {
  if (!left || Object.keys(left).length !== Object.keys(right).length) return false;
  return Object.entries(right).every(([key, value]) => {
    const previous = left[key];
    return previous === value || (Array.isArray(value) && Array.isArray(previous) &&
      value.length === previous.length && value.every((item, index) => item === previous[index]));
  });
}

export function createDataState() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    tokens: {},
    events: [],
    narrativeJobs: {},
    updatedAt: 0,
  };
}

export function applyScanToState(currentState, tokens, options) {
  const state = currentState || createDataState();
  const now = options.now;
  const baseline = Boolean(options.baseline);
  const completeSnapshot = Boolean(options.completeSnapshot);
  const maxEvents = options.maxEvents;
  const retentionMs = options.retentionDays * 24 * 60 * 60 * 1000;
  const uniqueTokens = Array.from(new Map(tokens.map(token => [token.id, token])).values());
  const currentIds = new Set(uniqueTokens.map((token) => token.id));
  const retainedEntries = Object.entries(state.tokens).filter(([, token]) => {
    const lastPresence = token.missingSince ?? token.lastSeen ?? token.lastAppearedAt ?? token.firstSeen;
    return !Number.isFinite(lastPresence) || now - lastPresence < retentionMs;
  });
  const removed = Object.keys(state.tokens).length - retainedEntries.length;
  const retainedTokens = Object.fromEntries(retainedEntries);
  const previousAlertTimes = new Map(
    state.events
      .filter((event) => !event.manual && event.id && Number.isFinite(event.detectedAt))
      .map((event) => [event.id, event.detectedAt]),
  );
  let changed = removed > 0 || state.schemaVersion !== DATA_SCHEMA_VERSION;
  const tokensWithAbsence = completeSnapshot
    ? Object.entries(retainedTokens).reduce((records, [id, token]) => {
        const absent = !currentIds.has(id) && token.missingSince == null;
        if (absent) changed = true;
        records[id] = absent ? { ...token, missingSince: now } : token;
        return records;
      }, {})
    : retainedTokens;
  const seenBeforeScan = new Set(Object.keys(tokensWithAbsence));
  const fresh = baseline ? [] : uniqueTokens.filter((token) => !seenBeforeScan.has(token.id));
  const isInAlertRange = (token) =>
    Number.isInteger(token.rank) && token.rank >= 1 && token.rank <= options.alertTopN;
  const wasAlerted = (token) => {
    const previous = tokensWithAbsence[token.id];
    return Boolean(previous) && (Number.isFinite(previous.alertedAt) || previousAlertTimes.has(token.id));
  };
  const eligible = (token) => isInAlertRange(token) && passesAlertFilters(token, options);
  const alerts = baseline ? [] : uniqueTokens.filter((token) => eligible(token) && !wasAlerted(token));
  const alertIds = new Set(alerts.map((token) => token.id));

  const updatedTokens = uniqueTokens.reduce((records, token) => {
    const previous = tokensWithAbsence[token.id];
    const previousAlertedAt = previous
      ? (Number.isFinite(previous.alertedAt) ? previous.alertedAt : previousAlertTimes.get(token.id))
      : undefined;
    const lastSeen = previous?.lastSeen;
    const next = {
      ...compactTokenRecord(previous || {}),
      ...compactTokenRecord(token),
      firstSeen: previous?.firstSeen ?? now,
      // 合并只含时间变化的写入，持续出现的币种最多每分钟续期一次。
      lastSeen: Number.isFinite(lastSeen) && now - lastSeen < LIMITS.LAST_SEEN_WRITE_INTERVAL_MS
        ? lastSeen : now,
      lastAppearedAt: previous?.missingSince != null
        ? now
        : previous?.lastAppearedAt || previous?.lastSeen || previous?.firstSeen || now,
      missingSince: null,
      baseline: previous ? previous.baseline : baseline,
      alertedAt: previousAlertedAt ?? ((baseline && eligible(token)) || alertIds.has(token.id) ? now : null),
    };
    const unchanged = sameRecord(previous, next);
    if (!unchanged) changed = true;
    records[token.id] = unchanged ? previous : next;
    return records;
  }, { ...tokensWithAbsence });

  const newEvents = alerts.map((token) => ({
    ...token, ...(token.snapshot ? { snapshot: token.snapshot.slice(0, LIMITS.SNAPSHOT_LENGTH) } : {}), detectedAt: now,
  }));
  const events = newEvents.length ? [...newEvents.reverse(), ...state.events].slice(0, maxEvents) : state.events;
  if (newEvents.length) changed = true;
  const nextState = changed ? {
    ...state,
    schemaVersion: DATA_SCHEMA_VERSION,
    tokens: updatedTokens,
    events,
    updatedAt: now,
  } : state;

  return {
    state: nextState,
    changed,
    report: {
      baseline,
      completeSnapshot,
      currentCount: tokens.length,
      totalSeen: Object.keys(updatedTokens).length,
      fresh: fresh.map((token) => ({ ...token, detectedAt: now })),
      alerts: alerts.map((token) => ({ ...token, detectedAt: now })),
      recentEvents: events,
      processedAt: now,
      removed,
    },
  };
}
