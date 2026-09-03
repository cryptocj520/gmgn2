import { DATA_SCHEMA_VERSION } from "./constants.js";

export function createDataState() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    tokens: {},
    events: [],
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
  const currentIds = new Set(tokens.map((token) => token.id));
  const retainedEntries = Object.entries(state.tokens).filter(([, token]) =>
    token.missingSince == null || now - token.missingSince < retentionMs
  );
  const removed = Object.keys(state.tokens).length - retainedEntries.length;
  const retainedTokens = Object.fromEntries(retainedEntries);
  const tokensWithAbsence = completeSnapshot
    ? Object.entries(retainedTokens).reduce((records, [id, token]) => {
        records[id] = currentIds.has(id)
          ? token
          : { ...token, missingSince: token.missingSince ?? now };
        return records;
      }, {})
    : retainedTokens;
  const seenBeforeScan = new Set(Object.keys(tokensWithAbsence));
  const fresh = baseline ? [] : tokens.filter((token) => !seenBeforeScan.has(token.id));
  const alerts = fresh.filter((token) =>
    Number.isInteger(token.rank) && token.rank >= 1 && token.rank <= options.alertTopN
  );

  const updatedTokens = tokens.reduce((records, token) => {
    const previous = tokensWithAbsence[token.id];
    records[token.id] = {
      ...previous,
      ...token,
      firstSeen: previous?.firstSeen || now,
      lastAppearedAt: previous?.missingSince != null
        ? now
        : previous?.lastAppearedAt || previous?.lastSeen || previous?.firstSeen || now,
      missingSince: null,
      baseline: previous ? previous.baseline : baseline,
    };
    return records;
  }, { ...tokensWithAbsence });

  const newEvents = alerts.map((token) => ({ ...token, detectedAt: now }));
  const events = [...newEvents.reverse(), ...state.events].slice(0, maxEvents);
  const nextState = {
    ...state,
    schemaVersion: DATA_SCHEMA_VERSION,
    tokens: updatedTokens,
    events,
    updatedAt: now,
  };

  return {
    state: nextState,
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
