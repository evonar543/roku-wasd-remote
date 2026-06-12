import "./styles.css";

type RokuDevice = {
  id: string;
  name: string;
  modelName: string;
  serialNumber?: string;
  host: string;
  port: number;
  location: string;
  macs: string[];
};

type RokuApi = {
  discover: () => Promise<RokuDevice[]>;
  connect: (target: string) => Promise<RokuDevice>;
  sendKey: (device: RokuDevice, key: string) => Promise<{ ok: boolean }>;
  sendText: (device: RokuDevice, text: string) => Promise<{ ok: boolean }>;
  wake: (device: RokuDevice) => Promise<{ ok: boolean; method: string }>;
  startVoice: () => Promise<{ ok: boolean; listening: boolean }>;
  stopVoice: () => Promise<{ ok: boolean; listening: boolean }>;
  onVoiceResult: (callback: (result: VoiceResult) => void) => () => void;
};

type VoiceResult = {
  type: "ready" | "command" | "error" | "stopped";
  text: string;
  confidence?: number;
};

declare global {
  interface Window {
    rokuRemote?: RokuApi;
  }
}

const KEY_REPEAT_DELAY_MS = 95;
const HOLD_START_DELAY_MS = 280;
const POINTER_REPEAT_MS = 145;
const VOICE_REPEAT_DELAY_MS = 120;
const MAX_LOG_ROWS = 10;

const keyMap = new Map<string, string>([
  ["KeyW", "Up"],
  ["KeyA", "Left"],
  ["KeyS", "Down"],
  ["KeyD", "Right"],
  ["ArrowUp", "Up"],
  ["ArrowLeft", "Left"],
  ["ArrowDown", "Down"],
  ["ArrowRight", "Right"],
  ["Enter", "Select"],
  ["Space", "Select"],
  ["Escape", "Back"],
  ["Backspace", "Back"],
  ["KeyH", "Home"],
  ["KeyM", "Info"],
  ["KeyP", "Play"],
  ["KeyQ", "Rev"],
  ["KeyE", "Fwd"],
  ["Minus", "VolumeDown"],
  ["Equal", "VolumeUp"],
  ["KeyV", "VolumeMute"]
]);

const remoteButtons = [
  { key: "Home", label: "Home", icon: "home" },
  { key: "Back", label: "Back", icon: "back" },
  { key: "Info", label: "Menu", icon: "menu" },
  { key: "Select", label: "Enter", icon: "select" },
  { key: "Search", label: "Search", icon: "search" },
  { key: "InstantReplay", label: "Replay", icon: "replay" },
  { key: "Backspace", label: "Delete", icon: "delete" },
  { key: "Enter", label: "Submit", icon: "submit" },
  { key: "PowerOn", label: "Power on", icon: "power" },
  { key: "PowerOff", label: "Power off", icon: "power" }
];

const mediaButtons = [
  { key: "Rev", label: "Rewind", hold: true },
  { key: "Play", label: "Play / Pause" },
  { key: "Fwd", label: "Forward", hold: true },
  { key: "VolumeDown", label: "Hold Vol -", hold: true },
  { key: "VolumeMute", label: "Mute" },
  { key: "VolumeUp", label: "Hold Vol +", hold: true },
  { key: "ChannelDown", label: "Hold Ch -", hold: true },
  { key: "ChannelUp", label: "Hold Ch +", hold: true }
];

const inputButtons = [
  { key: "InputTuner", label: "TV tuner" },
  { key: "InputHDMI1", label: "HDMI 1" },
  { key: "InputHDMI2", label: "HDMI 2" },
  { key: "InputHDMI3", label: "HDMI 3" },
  { key: "InputHDMI4", label: "HDMI 4" }
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root.");
}
const appRoot = app;

const state: {
  devices: RokuDevice[];
  selected: RokuDevice | null;
  scanning: boolean;
  busyKey: string;
  error: string;
  manualIp: string;
    textValue: string;
    log: string[];
    lastKeyAt: number;
    repeatMs: number;
    holdKey: string;
    voiceListening: boolean;
    voiceStatus: string;
    lastVoiceText: string;
    mouseStart: { x: number; y: number } | null;
  } = {
  devices: [],
  selected: null,
  scanning: false,
  busyKey: "",
  error: "",
    manualIp: "",
    textValue: "",
    log: ["Ready. Scan for a Roku or type its IP."],
    lastKeyAt: 0,
    repeatMs: POINTER_REPEAT_MS,
    holdKey: "",
    voiceListening: false,
    voiceStatus: "Off",
    lastVoiceText: "",
    mouseStart: null
  };
let holdStartTimer: number | undefined;
let holdRepeatTimer: number | undefined;

function getApi(): RokuApi {
  if (!window.rokuRemote) {
    throw new Error("Roku bridge is not available. Run this through Electron.");
  }
  return window.rokuRemote;
}

function addLog(message: string) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
  state.log = [`${time}  ${message}`, ...state.log].slice(0, MAX_LOG_ROWS);
}

function setError(error: unknown) {
  state.error = error instanceof Error ? error.message : String(error);
  addLog(`Error: ${state.error}`);
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

async function scanDevices() {
  state.scanning = true;
  state.error = "";
  render();

  try {
    const devices = await getApi().discover();
    state.devices = devices;
    state.selected = devices[0] ?? state.selected;
    addLog(devices.length ? `Found ${devices.length} Roku device${devices.length === 1 ? "" : "s"}.` : "No Roku found on this network.");
  } catch (error) {
    setError(error);
  } finally {
    state.scanning = false;
    render();
  }
}

async function connectManual() {
  state.error = "";
  state.busyKey = "connect";
  render();

  try {
    const device = await getApi().connect(state.manualIp);
    state.devices = [device, ...state.devices.filter((item) => item.id !== device.id)];
    state.selected = device;
    addLog(`Connected to ${device.name} at ${device.host}.`);
  } catch (error) {
    setError(error);
  } finally {
    state.busyKey = "";
    render();
  }
}

async function sendKey(key: string, options: { log?: boolean; renderBusy?: boolean } = {}) {
  const shouldLog = options.log ?? true;
  const shouldRenderBusy = options.renderBusy ?? true;
  if (!state.selected) {
    state.error = "Connect to a Roku first.";
    render();
    return;
  }

  if (shouldRenderBusy) {
    state.busyKey = key;
  }
  state.error = "";
  if (shouldRenderBusy) {
    render();
  }

  try {
    await getApi().sendKey(state.selected, key);
    if (shouldLog) {
      addLog(`Sent ${key}.`);
    }
  } catch (error) {
    setError(error);
  } finally {
    if (shouldRenderBusy) {
      state.busyKey = "";
      render();
    }
  }
}

async function sendKeySequence(key: string, count: number, label: string) {
  const total = Math.max(1, Math.min(count, 10));
  for (let index = 0; index < total; index += 1) {
    await sendKey(key, { log: false, renderBusy: index === 0 });
    if (index < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, VOICE_REPEAT_DELAY_MS));
    }
  }
  addLog(`${label}: ${key}${total > 1 ? ` x${total}` : ""}.`);
  render();
}

function startHold(key: string) {
  stopHold();
  state.holdKey = key;
  void sendKey(key, { log: false, renderBusy: true });
  holdStartTimer = window.setTimeout(() => {
    holdRepeatTimer = window.setInterval(() => {
      void sendKey(key, { log: false, renderBusy: false });
    }, state.repeatMs);
  }, HOLD_START_DELAY_MS);
}

function stopHold() {
  if (holdStartTimer) {
    window.clearTimeout(holdStartTimer);
    holdStartTimer = undefined;
  }
  if (holdRepeatTimer) {
    window.clearInterval(holdRepeatTimer);
    holdRepeatTimer = undefined;
  }
  if (state.holdKey) {
    addLog(`Held ${state.holdKey}.`);
    state.holdKey = "";
    render();
  }
}

async function wakeSelected() {
  if (!state.selected) {
    state.error = "Connect to a Roku first.";
    render();
    return;
  }

  state.busyKey = "wake";
  state.error = "";
  render();

  try {
    const result = await getApi().wake(state.selected);
    addLog(`Wake sent with ${result.method}.`);
  } catch (error) {
    setError(error);
  } finally {
    state.busyKey = "";
    render();
  }
}

async function sendText() {
  if (!state.selected || !state.textValue.trim()) {
    return;
  }

  state.busyKey = "text";
  state.error = "";
  render();

  try {
    await getApi().sendText(state.selected, state.textValue);
    addLog(`Typed ${state.textValue.length} character${state.textValue.length === 1 ? "" : "s"}.`);
    state.textValue = "";
  } catch (error) {
    setError(error);
  } finally {
    state.busyKey = "";
    render();
  }
}

async function toggleVoice() {
  state.error = "";
  state.busyKey = "voice";
  render();

  try {
    if (state.voiceListening) {
      await getApi().stopVoice();
      state.voiceListening = false;
      state.voiceStatus = "Off";
      addLog("Voice control stopped.");
    } else {
      await getApi().startVoice();
      state.voiceListening = true;
      state.voiceStatus = "Starting...";
      addLog("Voice control starting.");
    }
  } catch (error) {
    setError(error);
  } finally {
    state.busyKey = "";
    render();
  }
}

function parseCount(text: string) {
  const counts: Record<string, number> = {
    one: 1,
    won: 1,
    two: 2,
    to: 2,
    too: 2,
    three: 3,
    four: 4,
    for: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    ate: 8,
    nine: 9,
    ten: 10,
    twice: 2,
    thrice: 3
  };
  const numberMatch = text.match(/\b(10|[1-9])\b/);
  if (numberMatch) {
    return Number(numberMatch[1]);
  }
  for (const [word, count] of Object.entries(counts)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return count;
    }
  }
  return 1;
}

function parseVoiceCommand(rawText: string): { key: string; count: number; label: string; wake?: boolean } | null {
  const text = rawText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const count = parseCount(text);
  const directionMap: Record<string, string> = { up: "Up", down: "Down", left: "Left", right: "Right" };
  for (const [word, key] of Object.entries(directionMap)) {
    if (new RegExp(`\\b(go |move |press )?${word}\\b`).test(text)) {
      return { key, count, label: `Voice "${rawText}"` };
    }
  }

  const phraseMap: Array<[RegExp, string, boolean?]> = [
    [/\b(power on|turn on|wake tv)\b/, "PowerOn", true],
    [/\b(power off|turn off)\b/, "PowerOff"],
    [/\b(home|go home)\b/, "Home"],
    [/\b(go back|back)\b/, "Back"],
    [/\b(ok|select|enter)\b/, "Select"],
    [/\b(play pause|pause|play)\b/, "Play"],
    [/\b(mute)\b/, "VolumeMute"],
    [/\b(turn volume down|volume down)\b/, "VolumeDown"],
    [/\b(turn volume up|volume up)\b/, "VolumeUp"],
    [/\b(channel down)\b/, "ChannelDown"],
    [/\b(channel up)\b/, "ChannelUp"],
    [/\b(search)\b/, "Search"],
    [/\b(menu|options)\b/, "Info"],
    [/\b(replay)\b/, "InstantReplay"],
    [/\b(rewind)\b/, "Rev"],
    [/\b(fast forward|forward)\b/, "Fwd"],
    [/\b(input tuner|tv tuner)\b/, "InputTuner"],
    [/\b(hdmi one)\b/, "InputHDMI1"],
    [/\b(hdmi two)\b/, "InputHDMI2"],
    [/\b(hdmi three)\b/, "InputHDMI3"],
    [/\b(hdmi four)\b/, "InputHDMI4"]
  ];

  for (const [pattern, key, wake] of phraseMap) {
    if (pattern.test(text)) {
      return { key, count, label: `Voice "${rawText}"`, wake };
    }
  }
  return null;
}

async function runVoiceCommand(text: string) {
  const command = parseVoiceCommand(text);
  state.lastVoiceText = text;
  if (!command) {
    addLog(`Voice heard "${text}" but no command matched.`);
    render();
    return;
  }
  if (command.wake) {
    await wakeSelected();
    return;
  }
  await sendKeySequence(command.key, command.count, command.label);
}

function directionFromSwipe(start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 34) {
    return "Select";
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "Right" : "Left";
  }
  return dy > 0 ? "Down" : "Up";
}

function icon(name: string) {
  const paths: Record<string, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 1 1 0 14H7"/>',
      menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
      select: '<path d="M20 6 9 17l-5-5"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      replay: '<path d="M4 7v6h6"/><path d="M5 13a8 8 0 1 0 2-8.4L4 7"/>',
      delete: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M4 7h16"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
      submit: '<path d="M5 12h12"/><path d="m13 6 6 6-6 6"/>',
      power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
      mic: '<path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z"/><path d="M19 10a7 7 0 0 1-14 0"/><path d="M12 17v5"/><path d="M8 22h8"/>',
      mouse: '<rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 6v4"/>'
    };
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] ?? ""}</svg>`;
}

function button(label: string, className: string, attrs: string) {
  return `<button class="${className}" ${attrs}>${label}</button>`;
}

function render() {
  const selected = state.selected;
  const disabled = selected ? "" : "disabled";
  const voiceClass = state.voiceListening ? "online" : "";
  const holdAttrs = (key: string, extra = "") => `data-key="${key}" data-hold="true" ${extra} ${disabled}`;
  const deviceOptions = state.devices
    .map((device) => {
      const isSelected = selected?.id === device.id ? "selected" : "";
      return `<option value="${device.id}" ${isSelected}>${escapeHtml(device.name)} - ${escapeHtml(device.host)}</option>`;
    })
    .join("");

  appRoot.innerHTML = `
    <main class="shell">
      <section class="topbar" aria-label="Connection">
        <div class="brand">
          <div class="brand-mark">RW</div>
          <div>
            <h1>Roku WASD Remote</h1>
            <p>${selected ? `${escapeHtml(selected.name)} on ${escapeHtml(selected.host)}` : "Keyboard-first Roku control"}</p>
          </div>
        </div>
        <div class="connection-row">
          <button class="btn btn-primary" data-action="scan" ${state.scanning ? "disabled" : ""}>
            <span class="spinner ${state.scanning ? "is-visible" : ""}"></span>
            ${state.scanning ? "Scanning" : "Scan"}
          </button>
          <select class="input select" data-action="select-device" ${state.devices.length ? "" : "disabled"} aria-label="Discovered Roku devices">
            ${deviceOptions || '<option>No devices found yet</option>'}
          </select>
          <input class="input ip-input" data-action="manual-ip" value="${escapeAttr(state.manualIp)}" placeholder="Roku IP, e.g. 192.168.1.50" />
          <button class="btn btn-ghost" data-action="connect" ${state.busyKey === "connect" ? "disabled" : ""}>Connect</button>
        </div>
      </section>

      <section class="status-strip" aria-live="polite">
        <div class="status-dot ${selected ? "online" : ""}"></div>
        <span>${selected ? `Connected: ${escapeHtml(selected.modelName)}` : "No Roku connected"}</span>
        ${state.error ? `<strong>${escapeHtml(state.error)}</strong>` : ""}
      </section>

      <section class="layout">
          <article class="panel remote-panel">
            <div class="panel-heading">
              <div>
                <h2>Movement Pad</h2>
                <p>Hold W A S D, arrows, or the buttons for repeat movement.</p>
              </div>
              <button class="btn btn-danger" data-action="wake" ${disabled || state.busyKey === "wake" ? "disabled" : ""}>Wake TV</button>
            </div>

            <div class="wasd-pad" aria-label="WASD direction pad">
              ${button("W", `keycap up ${state.holdKey === "Up" ? "is-held" : ""}`, holdAttrs("Up"))}
              ${button("A", `keycap left ${state.holdKey === "Left" ? "is-held" : ""}`, holdAttrs("Left"))}
              ${button("Enter", "keycap enter", `data-key="Select" ${disabled}`)}
              ${button("D", `keycap right ${state.holdKey === "Right" ? "is-held" : ""}`, holdAttrs("Right"))}
              ${button("S", `keycap down ${state.holdKey === "Down" ? "is-held" : ""}`, holdAttrs("Down"))}
            </div>

            <div class="hint-grid">
              <span><kbd>Esc</kbd> Back</span>
              <span><kbd>H</kbd> Home</span>
              <span><kbd>- / =</kbd> Volume</span>
              <span><kbd>Q/E</kbd> Seek</span>
            </div>
          </article>

        <article class="panel controls-panel">
          <div class="panel-heading">
            <div>
              <h2>Remote Controls</h2>
              <p>Buttons with hold labels repeat while pressed.</p>
            </div>
          </div>
          <div class="button-grid">
            ${remoteButtons
              .map((item) =>
                button(`${icon(item.icon)}<span>${item.label}</span>`, "btn btn-tile", `data-key="${item.key}" ${disabled}`)
              )
              .join("")}
          </div>
          <div class="media-grid">
            ${mediaButtons
              .map((item) =>
                button(
                  item.label,
                  `btn btn-ghost compact ${item.hold && state.holdKey === item.key ? "is-held" : ""}`,
                  item.hold ? holdAttrs(item.key) : `data-key="${item.key}" ${disabled}`
                )
              )
              .join("")}
          </div>
          <div class="input-grid">
            ${inputButtons.map((item) => button(item.label, "btn btn-ghost compact", `data-key="${item.key}" ${disabled}`)).join("")}
          </div>
        </article>

        <article class="panel mouse-panel">
          <div class="panel-heading">
            <div>
              <h2>Mouse Pad</h2>
              <p>Click for select, drag or flick for directions, wheel for volume.</p>
            </div>
            ${icon("mouse")}
          </div>
          <div class="mouse-pad" data-action="mouse-pad" role="button" tabindex="0" aria-label="Mouse directional pad">
            <span>Click</span>
            <strong>Drag / Flick</strong>
            <small>Wheel = volume</small>
          </div>
        </article>

        <article class="panel voice-panel">
          <div class="panel-heading">
            <div>
              <h2>Live Voice</h2>
              <p>Say “move down three”, “pause”, “power off”, or “volume down”.</p>
            </div>
            <div class="status-dot ${voiceClass}"></div>
          </div>
          <button class="btn ${state.voiceListening ? "btn-danger" : "btn-primary"} voice-toggle" data-action="voice" ${state.busyKey === "voice" ? "disabled" : ""}>
            ${icon("mic")}
            <span>${state.voiceListening ? "Stop voice" : "Start voice"}</span>
          </button>
          <div class="voice-readout">
            <span>Status</span>
            <strong>${escapeHtml(state.voiceStatus)}</strong>
          </div>
          <div class="voice-readout">
            <span>Last heard</span>
            <strong>${state.lastVoiceText ? escapeHtml(state.lastVoiceText) : "Nothing yet"}</strong>
          </div>
          <div class="voice-examples">
            <kbd>move down 3</kbd>
            <kbd>go up</kbd>
            <kbd>pause</kbd>
            <kbd>power off</kbd>
            <kbd>hdmi one</kbd>
          </div>
        </article>

        <article class="panel text-panel">
          <div class="panel-heading">
            <div>
              <h2>Text Keyboard</h2>
              <p>Paste or type search/login text, then send it to the focused Roku field.</p>
            </div>
          </div>
          <textarea class="input text-box" data-action="text-value" placeholder="Type text for the Roku here...">${escapeHtml(state.textValue)}</textarea>
          <div class="text-actions">
            <button class="btn btn-primary" data-action="send-text" ${disabled || !state.textValue.trim() || state.busyKey === "text" ? "disabled" : ""}>Send text</button>
            <button class="btn btn-ghost" data-action="clear-text" ${state.textValue ? "" : "disabled"}>Clear</button>
          </div>
        </article>

        <article class="panel log-panel">
          <div class="panel-heading">
            <div>
              <h2>Command Log</h2>
              <p>${state.log.length ? "Recent Roku commands and connection status." : "No commands yet."}</p>
            </div>
          </div>
          <ol class="log-list">
            ${state.log.length ? state.log.map((row) => `<li>${escapeHtml(row)}</li>`).join("") : "<li>No items yet.</li>"}
          </ol>
        </article>
      </section>
    </main>
  `;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char);
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

appRoot.addEventListener("click", (event) => {
  const buttonEl = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!buttonEl || buttonEl.disabled) {
    return;
  }
  if (buttonEl.dataset.hold === "true") {
    return;
  }

  const key = buttonEl.dataset.key;
  if (key) {
    void sendKey(key);
    return;
  }

  const action = buttonEl.dataset.action;
  if (action === "scan") void scanDevices();
  if (action === "connect") void connectManual();
  if (action === "wake") void wakeSelected();
  if (action === "voice") void toggleVoice();
  if (action === "send-text") void sendText();
  if (action === "clear-text") {
    state.textValue = "";
    render();
  }
});

appRoot.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const buttonEl = target.closest<HTMLButtonElement>("button[data-hold='true']");
  if (buttonEl && !buttonEl.disabled && buttonEl.dataset.key) {
    event.preventDefault();
    buttonEl.setPointerCapture(event.pointerId);
    startHold(buttonEl.dataset.key);
    return;
  }

  const mousePad = target.closest<HTMLElement>("[data-action='mouse-pad']");
  if (mousePad) {
    event.preventDefault();
    mousePad.setPointerCapture(event.pointerId);
    state.mouseStart = { x: event.clientX, y: event.clientY };
  }
});

appRoot.addEventListener("pointerup", (event) => {
  const target = event.target as HTMLElement;
  const mousePad = target.closest<HTMLElement>("[data-action='mouse-pad']");
  if (mousePad && state.mouseStart) {
    const key = directionFromSwipe(state.mouseStart, { x: event.clientX, y: event.clientY });
    state.mouseStart = null;
    void sendKey(key);
  }
  stopHold();
});

window.addEventListener("pointercancel", stopHold);
window.addEventListener("pointerup", stopHold);

appRoot.addEventListener(
  "wheel",
  (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-action='mouse-pad']")) {
      return;
    }
    event.preventDefault();
    void sendKey(event.deltaY > 0 ? "VolumeDown" : "VolumeUp");
  },
  { passive: false }
);

appRoot.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (target.dataset.action === "manual-ip") {
    state.manualIp = target.value;
  }
  if (target.dataset.action === "text-value") {
    state.textValue = target.value;
    render();
  }
  if (target.dataset.action === "select-device") {
    state.selected = state.devices.find((device) => device.id === target.value) ?? state.selected;
    render();
  }
});

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) {
    return;
  }

  const key = keyMap.get(event.code);
  if (!key) {
    return;
  }

  event.preventDefault();
  const now = Date.now();
  if (event.repeat && now - state.lastKeyAt < KEY_REPEAT_DELAY_MS) {
    return;
  }
  state.lastKeyAt = now;
  void sendKey(key, { log: !event.repeat, renderBusy: !event.repeat });
});

getApi().onVoiceResult((result) => {
  if (result.type === "ready") {
    state.voiceListening = true;
    state.voiceStatus = result.text;
    addLog("Voice model ready.");
    render();
    return;
  }
  if (result.type === "stopped") {
    state.voiceListening = false;
    state.voiceStatus = "Off";
    render();
    return;
  }
  if (result.type === "error") {
    state.voiceStatus = "Voice error";
    setError(result.text);
    render();
    return;
  }
  state.voiceStatus = `${Math.round((result.confidence ?? 0) * 100)}% confidence`;
  void runVoiceCommand(result.text);
});

render();
void scanDevices();
