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
};

declare global {
  interface Window {
    rokuRemote?: RokuApi;
  }
}

const KEY_REPEAT_DELAY_MS = 130;
const MAX_LOG_ROWS = 8;

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
  ["KeyE", "Fwd"]
]);

const remoteButtons = [
  { key: "Home", label: "Home", icon: "home" },
  { key: "Back", label: "Back", icon: "back" },
  { key: "Info", label: "Menu", icon: "menu" },
  { key: "Select", label: "Enter", icon: "select" },
  { key: "Search", label: "Search", icon: "search" },
  { key: "InstantReplay", label: "Replay", icon: "replay" }
];

const mediaButtons = [
  { key: "Rev", label: "Rewind" },
  { key: "Play", label: "Play / Pause" },
  { key: "Fwd", label: "Forward" },
  { key: "VolumeDown", label: "Vol -" },
  { key: "VolumeMute", label: "Mute" },
  { key: "VolumeUp", label: "Vol +" },
  { key: "ChannelDown", label: "Ch -" },
  { key: "ChannelUp", label: "Ch +" },
  { key: "PowerOff", label: "Power off" }
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
} = {
  devices: [],
  selected: null,
  scanning: false,
  busyKey: "",
  error: "",
  manualIp: "",
  textValue: "",
  log: ["Ready. Scan for a Roku or type its IP."],
  lastKeyAt: 0
};

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

async function sendKey(key: string) {
  if (!state.selected) {
    state.error = "Connect to a Roku first.";
    render();
    return;
  }

  state.busyKey = key;
  state.error = "";
  render();

  try {
    await getApi().sendKey(state.selected, key);
    addLog(`Sent ${key}.`);
  } catch (error) {
    setError(error);
  } finally {
    state.busyKey = "";
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

function icon(name: string) {
  const paths: Record<string, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 1 1 0 14H7"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
    select: '<path d="M20 6 9 17l-5-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    replay: '<path d="M4 7v6h6"/><path d="M5 13a8 8 0 1 0 2-8.4L4 7"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] ?? ""}</svg>`;
}

function button(label: string, className: string, attrs: string) {
  return `<button class="${className}" ${attrs}>${label}</button>`;
}

function render() {
  const selected = state.selected;
  const disabled = selected ? "" : "disabled";
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
              <p>W A S D sends directional Roku commands.</p>
            </div>
            <button class="btn btn-danger" data-action="wake" ${disabled || state.busyKey === "wake" ? "disabled" : ""}>Wake TV</button>
          </div>

          <div class="wasd-pad" aria-label="WASD direction pad">
            ${button("W", "keycap up", `data-key="Up" ${disabled}`)}
            ${button("A", "keycap left", `data-key="Left" ${disabled}`)}
            ${button("Enter", "keycap enter", `data-key="Select" ${disabled}`)}
            ${button("D", "keycap right", `data-key="Right" ${disabled}`)}
            ${button("S", "keycap down", `data-key="Down" ${disabled}`)}
          </div>

          <div class="hint-grid">
            <span><kbd>Esc</kbd> Back</span>
            <span><kbd>H</kbd> Home</span>
            <span><kbd>P</kbd> Play</span>
            <span><kbd>Q/E</kbd> Seek</span>
          </div>
        </article>

        <article class="panel controls-panel">
          <div class="panel-heading">
            <div>
              <h2>Remote Controls</h2>
              <p>Click or stay on the keyboard.</p>
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
            ${mediaButtons.map((item) => button(item.label, "btn btn-ghost compact", `data-key="${item.key}" ${disabled}`)).join("")}
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

  const key = buttonEl.dataset.key;
  if (key) {
    void sendKey(key);
    return;
  }

  const action = buttonEl.dataset.action;
  if (action === "scan") void scanDevices();
  if (action === "connect") void connectManual();
  if (action === "wake") void wakeSelected();
  if (action === "send-text") void sendText();
  if (action === "clear-text") {
    state.textValue = "";
    render();
  }
});

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
  void sendKey(key);
});

render();
void scanDevices();
