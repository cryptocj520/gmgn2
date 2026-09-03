export const PANEL_STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  button, select, input { font: inherit; letter-spacing: 0; }
  button { border: 0; }
  .launcher {
    position: fixed; right: 14px; top: 84px; z-index: 2147483646;
    width: 44px; height: 44px; display: none; place-items: center;
    border-radius: 8px; border: 1px solid #3d433b; background: #171a17;
    color: #d9f99d; cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.38);
  }
  .launcher.show { display: grid; }
  .launcher-icon { font-size: 20px; line-height: 1; }
  .launcher-badge {
    position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
    padding: 0 4px; display: none; place-items: center; border-radius: 9px;
    background: #ff6b57; color: #fff; font: 700 10px/1 -apple-system, sans-serif;
    border: 2px solid #101310;
  }
  .launcher-badge.show { display: grid; }
  .panel {
    position: fixed; z-index: 2147483646; top: 76px; right: 12px;
    width: min(372px, calc(100vw - 24px)); height: min(640px, calc(100vh - 92px));
    display: grid; grid-template-rows: auto auto auto 1fr auto;
    color: #f1f4ef; background: #111411; border: 1px solid #343a33;
    border-radius: 8px; overflow: hidden; box-shadow: 0 18px 54px rgba(0,0,0,.52);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    letter-spacing: 0;
  }
  .panel.hidden { display: none; }
  .header {
    height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px;
    border-bottom: 1px solid #2d322c; background: #151815;
  }
  .brand-mark { width: 9px; height: 24px; border-radius: 3px; background: #c9f26b; }
  .title-wrap { min-width: 0; flex: 1; }
  .title { color: #fff; font-size: 14px; font-weight: 720; line-height: 19px; }
  .subtitle { display: flex; align-items: center; gap: 6px; color: #8f998c; font-size: 11px; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #70786d; }
  .status-dot.running, .status-dot.found { background: #83d86b; box-shadow: 0 0 0 3px rgba(131,216,107,.12); }
  .status-dot.baselining, .status-dot.waiting { background: #f0b95b; }
  .status-dot.error { background: #ff6b57; }
  .icon-button {
    width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px;
    background: transparent; color: #aeb6aa; cursor: pointer; font-size: 16px;
  }
  .icon-button:hover { background: #262b25; color: #fff; }
  .toolbar { padding: 12px 14px; border-bottom: 1px solid #2d322c; }
  .primary-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; }
  .primary {
    height: 36px; display: flex; align-items: center; justify-content: center; gap: 7px;
    border-radius: 6px; background: #c9f26b; color: #14200c; font-weight: 750;
    cursor: pointer; padding: 0 13px;
  }
  .primary:hover { background: #d8ff82; }
  .primary.stop { background: #ff765f; color: #240b07; }
  .secondary {
    height: 36px; min-width: 36px; border-radius: 6px; border: 1px solid #3b4239;
    background: #1a1e1a; color: #dce1da; cursor: pointer;
  }
  .secondary:hover { border-color: #687164; background: #242924; }
  .sound-wrap {
    height: 36px; min-width: 58px; display: flex; align-items: center; gap: 7px;
    padding: 0 8px; border: 1px solid #3b4239; border-radius: 6px; background: #1a1e1a;
  }
  .sound-label { color: #c8cec5; font-size: 12px; }
  .switch { position: relative; width: 26px; height: 16px; flex: 0 0 auto; }
  .switch input { position: absolute; opacity: 0; pointer-events: none; }
  .switch-track { position: absolute; inset: 0; border-radius: 8px; background: #50574d; cursor: pointer; }
  .switch-track::after {
    content: ""; position: absolute; width: 12px; height: 12px; top: 2px; left: 2px;
    border-radius: 50%; background: #fff; transition: transform .15s ease;
  }
  .switch input:checked + .switch-track { background: #7aac45; }
  .switch input:checked + .switch-track::after { transform: translateX(10px); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #2d322c; background: #131613; }
  .stat { min-width: 0; padding: 10px 6px; text-align: center; border-right: 1px solid #292e28; }
  .stat:last-child { border-right: 0; }
  .stat-value { display: block; color: #edf1eb; font-size: 15px; font-weight: 720; line-height: 20px; }
  .stat-value.hot { color: #ff8d76; }
  .stat-label { display: block; color: #798276; font-size: 10px; line-height: 15px; }
  .content { min-height: 0; display: grid; grid-template-rows: auto 1fr; }
  .section-head { height: 40px; display: flex; align-items: center; padding: 0 14px; border-bottom: 1px solid #292e28; }
  .section-title { flex: 1; color: #cdd3ca; font-weight: 650; }
  .section-count { color: #7f887c; font-variant-numeric: tabular-nums; }
  .events { min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #42483f transparent; }
  .empty { height: 100%; min-height: 150px; display: grid; place-items: center; color: #727b70; text-align: center; }
  .empty-glyph { display: block; color: #4e564c; font-size: 24px; margin-bottom: 7px; }
  .event {
    display: grid; grid-template-columns: 36px minmax(0,1fr) auto; gap: 10px;
    align-items: center; min-height: 68px; padding: 9px 12px 9px 14px;
    color: inherit; text-decoration: none; border-bottom: 1px solid #252a24;
  }
  .event:hover { background: #1a1e1a; }
  .token-image {
    width: 36px; height: 36px; display: grid; place-items: center; overflow: hidden;
    border-radius: 6px; background: #2a3028; color: #c9f26b; font-weight: 800;
  }
  .token-image img { width: 100%; height: 100%; object-fit: cover; }
  .event-main { min-width: 0; }
  .event-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .symbol { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; color: #fff; }
  .chain { color: #9da797; font-size: 10px; text-transform: uppercase; }
  .event-meta { display: block; margin-top: 4px; color: #828b7f; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .event-side { text-align: right; }
  .market-cap { display: block; color: #eabf65; font-size: 12px; font-weight: 650; }
  .event-time { display: block; margin-top: 4px; color: #737c70; font-size: 10px; }
  .settings {
    display: none; position: absolute; inset: 52px 0 0; z-index: 3;
    background: #111411; padding: 14px; overflow: auto;
  }
  .settings.show { display: block; }
  .settings-title { margin: 0 0 12px; font-size: 14px; color: #f2f5ef; }
  .setting-row { min-height: 54px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #292e28; }
  .setting-main { min-width: 0; flex: 1; }
  .setting-name { color: #dce1da; line-height: 18px; }
  .setting-note { color: #747d71; font-size: 10px; line-height: 15px; }
  select { height: 32px; min-width: 78px; padding: 0 8px; color: #e5e9e2; background: #1c201c; border: 1px solid #3b4239; border-radius: 6px; }
  .number-input { width: 60px; height: 32px; padding: 0 7px; color: #e5e9e2; background: #1c201c; border: 1px solid #3b4239; border-radius: 6px; text-align: right; }
  .unit { color: #8d9789; font-size: 11px; }
  .data-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 18px; }
  .action-button { height: 34px; border-radius: 6px; border: 1px solid #3b4239; background: #1b1f1b; color: #d8ded5; cursor: pointer; }
  .action-button.danger { color: #ff8e7c; border-color: #5b3731; }
  .footer { min-height: 35px; display: flex; align-items: center; gap: 7px; padding: 0 14px; color: #788175; background: #151815; border-top: 1px solid #2d322c; font-size: 10px; }
  .footer-state { width: 6px; height: 6px; border-radius: 50%; background: #c9f26b; }
  .footer-spacer { flex: 1; }
  .version { color: #596157; }
  .toast { position: absolute; left: 14px; right: 14px; bottom: 44px; z-index: 5; display: none; padding: 9px 11px; border-radius: 6px; color: #edf1eb; background: #30372e; border: 1px solid #465043; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  .toast.show { display: block; }
  .toast.error { background: #442620; border-color: #6e3d34; }
  @media (max-width: 520px) {
    .panel { top: 8px; right: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); }
    .launcher { top: 68px; right: 8px; }
  }
  @media (prefers-reduced-motion: reduce) { .switch-track::after { transition: none; } }
`;
