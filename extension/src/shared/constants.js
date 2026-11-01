export const MESSAGE = Object.freeze({
  GET_BOOTSTRAP: "GET_BOOTSTRAP",
  PROCESS_SCAN: "PROCESS_SCAN",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
  TEST_SOUND: "TEST_SOUND",
  GET_EXPORT_DATA: "GET_EXPORT_DATA",
  CLEAR_DATA: "CLEAR_DATA",
  UPDATE_BADGE: "UPDATE_BADGE",
  PLAY_SOUND: "PLAY_SOUND",
  AI_FETCH: "AI_FETCH",
  OFFSCREEN_PING: "OFFSCREEN_PING",
  TEST_GROK_API: "TEST_GROK_API",
  RETRY_NARRATIVE: "RETRY_NARRATIVE",
  MANUAL_NARRATIVE: "MANUAL_NARRATIVE",
  MANUAL_CA_NARRATIVE: "MANUAL_CA_NARRATIVE",
  TOGGLE_FAVORITE: "TOGGLE_FAVORITE",
  GET_CURRENT_TOP_TOKEN: "GET_CURRENT_TOP_TOKEN",
  SAVE_AI_CONFIG: "SAVE_AI_CONFIG",
});

export const MESSAGE_TARGET = Object.freeze({
  BACKGROUND: "background",
  OFFSCREEN: "offscreen",
  CONTENT: "content",
});

export const STORAGE_KEYS = Object.freeze({
  DATA: "gmgnMonitorDataV2",
  SETTINGS: "gmgnMonitorSettingsV2",
  INTEGRATIONS: "gmgnMonitorIntegrationsV1",
  AI_CONFIG: "gmgnAiConfigV1",
  AI_USAGE: "gmgnAiUsageV1",
  LAST_CHAIN: "gmgnLastTrendChain",
  FAVORITES: "gmgnFavoritesV1",
  CONFIDENCE_GROUP: "gmgnConfidenceGroupV1",
});

export const CONFIDENCE_GROUP_LEVELS = Object.freeze(["medium", "high"]);

export const DATA_SCHEMA_VERSION = 6;

export const DEFAULT_SETTINGS = Object.freeze({
  autoStart: true,
  sound: true,
  desktopNotifications: false,
  intervalSeconds: 10,
  retentionDays: 7,
  autoRefreshOnStall: true,
  connectionTimeoutSeconds: 30,
  alertTopN: 5,
  narrativeEnabled: true,
  maxConcurrentAnalyses: 2,
  minLiquidity: 0,
  minHolders: 0,
  minMarketCap: 0,
  panelSize: "small",
  panelPosition: null,
});

export const LIMITS = Object.freeze({
  MAX_EVENTS: 300,
  PANEL_EVENTS: 100,
  SNAPSHOT_LENGTH: 240,
  LAST_SEEN_WRITE_INTERVAL_MS: 60000,
  MIN_CONCURRENT_ANALYSES: 1,
  MAX_CONCURRENT_ANALYSES: 3,
  MIN_RETENTION_DAYS: 1,
  MAX_RETENTION_DAYS: 365,
  MIN_CONNECTION_TIMEOUT_SECONDS: 10,
  MAX_CONNECTION_TIMEOUT_SECONDS: 300,
  MIN_ALERT_TOP_N: 1,
  MAX_ALERT_TOP_N: 100,
  MAX_NARRATIVE_LINKS: 8,
  MAX_FAVORITES: 200,
  MAX_CONFIDENCE_GROUP: 200,
});

export const GROK = Object.freeze({
  API_BASE_URL: "",
  MODEL: "grok-4.6",
  REQUEST_TIMEOUT_MS: 300000,
  VALIDATION_TIMEOUT_MS: 180000,
  MAX_OUTPUT_TOKENS: 4000,
  MAX_TOOL_CALLS: 3,
  MAX_CONCURRENT_ANALYSES: 2,
  PROCESSING_LEASE_MS: 330000,
  MAX_RETRIES: 1,
  RETRY_DELAY_MS: 15000,
  ALARM_PREFIX: "gmgn-narrative:",
  MIN_TIMEOUT_SECONDS: 15,
  MAX_TIMEOUT_SECONDS: 300,
  DEFAULT_TIMEOUT_SECONDS: 300,
  RECENT_ANALYSIS_HOURS: 6,
  MAX_USAGE_RECORDS: 200,
});

export const WATCHDOG = Object.freeze({
  MAX_RELOADS: 3,
  RELOAD_WINDOW_MINUTES: 15,
  RELOAD_DELAY_MS: 1200,
  STORAGE_KEY: "gmgnMonitorWatchdogV1",
});

export const SCANNER = Object.freeze({
  MAX_SCROLL_STEPS: 80,
  STEP_RATIO: 0.78,
  RENDER_WAIT_MS: 35,
  MIN_SCROLL_DISTANCE: 24,
  FULL_SCAN_INTERVAL_SECONDS: 60,
  OBSERVER_REATTACH_SECONDS: 2,
});

export const ALERT_SOUND = Object.freeze({
  volume: 0.9,
  durationSeconds: 0.58,
  strikes: [
    { delaySeconds: 0, frequency: 880 },
    { delaySeconds: 0.34, frequency: 1174.66 },
    { delaySeconds: 0.68, frequency: 1567.98 },
  ],
  partials: [
    { ratio: 1, gain: 0.5, type: "sine" },
    { ratio: 2.01, gain: 0.24, type: "triangle" },
    { ratio: 3.92, gain: 0.1, type: "sine" },
  ],
});

export const GMGN_URL = "https://gmgn.ai/trend";
