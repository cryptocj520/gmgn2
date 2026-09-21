export const MESSAGE = Object.freeze({
  GET_BOOTSTRAP: "GET_BOOTSTRAP",
  PROCESS_SCAN: "PROCESS_SCAN",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
  TEST_SOUND: "TEST_SOUND",
  GET_EXPORT_DATA: "GET_EXPORT_DATA",
  CLEAR_DATA: "CLEAR_DATA",
  UPDATE_BADGE: "UPDATE_BADGE",
  PLAY_SOUND: "PLAY_SOUND",
  BRIDGE_FETCH: "BRIDGE_FETCH",
  OFFSCREEN_PING: "OFFSCREEN_PING",
  TEST_GROK_API: "TEST_GROK_API",
  RETRY_NARRATIVE: "RETRY_NARRATIVE",
  MANUAL_NARRATIVE: "MANUAL_NARRATIVE",
  GET_CURRENT_TOP_TOKEN: "GET_CURRENT_TOP_TOKEN",
  SAVE_LOCAL_ANALYZER: "SAVE_LOCAL_ANALYZER",
  MIGRATE_LEGACY_AI_CONFIG: "MIGRATE_LEGACY_AI_CONFIG",
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
});

export const DATA_SCHEMA_VERSION = 5;

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
  grokBaseUrl: "https://api.x.ai/v1",
  grokModel: "grok-4.6",
  grokApiMode: "auto",
  grokEnableXSearch: true,
  bridgeFallbackEnabled: true,
  bridgeBaseUrl: "http://127.0.0.1:18761",
});

export const LIMITS = Object.freeze({
  MAX_EVENTS: 300,
  PANEL_EVENTS: 100,
  SNAPSHOT_LENGTH: 1800,
  MIN_RETENTION_DAYS: 1,
  MAX_RETENTION_DAYS: 365,
  MIN_CONNECTION_TIMEOUT_SECONDS: 10,
  MAX_CONNECTION_TIMEOUT_SECONDS: 300,
  MIN_ALERT_TOP_N: 1,
  MAX_ALERT_TOP_N: 100,
  MAX_NARRATIVE_LINKS: 8,
});

export const GROK = Object.freeze({
  API_BASE_URL: "https://api.x.ai/v1",
  MODEL: "grok-4.6",
  REQUEST_TIMEOUT_MS: 90000,
  VALIDATION_TIMEOUT_MS: 15000,
  MAX_TOOL_CALLS: 3,
  MAX_CONCURRENT_ANALYSES: 1,
  PROCESSING_LEASE_MS: 200000,
  MAX_RETRIES: 1,
  RETRY_DELAY_MS: 15000,
  ALARM_PREFIX: "gmgn-narrative:",
  BRIDGE_BASE_URL: "http://127.0.0.1:18761",
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

export const GMGN_URL = "https://gmgn.ai/trend?chain=robinhood";
