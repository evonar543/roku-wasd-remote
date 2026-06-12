const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const dgram = require("node:dgram");
const { spawn } = require("node:child_process");

const ECP_PORT = 8060;
const DISCOVERY_TIMEOUT_MS = 3200;
const ROKU_ST = "roku:ecp";
const XML_FIELDS = [
  "friendly-device-name",
  "user-device-name",
  "friendlyName",
  "model-name",
  "model-number",
  "serial-number",
  "udn",
  "wifi-mac",
  "ethernet-mac"
];
let voiceProcess = null;
let voiceOwner = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 620,
    title: "Roku WASD Remote",
    backgroundColor: "#0f0f13",
    webPreferences: {
      preload: path.join(__dirname, "roku-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.ROKU_REMOTE_DEV_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(app.getAppPath(), "roku-dist", "roku.html"));
  }
}

function normalizeDeviceTarget(target) {
  const value = String(target || "").trim();
  if (!value) {
    throw new Error("Enter a Roku IP address first.");
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(withProtocol);
  if (!url.port) {
    url.port = String(ECP_PORT);
  }
  return url;
}

function parseHeaders(response) {
  const headers = {};
  for (const line of response.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      headers[match[1].toLowerCase()] = match[2].trim();
    }
  }
  return headers;
}

function parseXmlField(xml, field) {
  const match = xml.match(new RegExp(`<${field}>([^<]*)</${field}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeMac(value) {
  const compact = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (compact.length !== 12 || /^0+$/.test(compact)) {
    return "";
  }
  return compact.match(/.{1,2}/g).join(":");
}

function deviceFromXml(location, xml) {
  const url = new URL(location);
  const fields = Object.fromEntries(XML_FIELDS.map((field) => [field, parseXmlField(xml, field)]));
  const name =
    fields["friendly-device-name"] ||
    fields["user-device-name"] ||
    fields.friendlyName ||
    "Roku device";
  const macs = [normalizeMac(fields["wifi-mac"]), normalizeMac(fields["ethernet-mac"])].filter(Boolean);

  return {
    id: fields.udn || fields["serial-number"] || `${url.hostname}:${url.port || ECP_PORT}`,
    name,
    modelName: fields["model-name"] || fields["model-number"] || "Roku",
    serialNumber: fields["serial-number"],
    host: url.hostname,
    port: Number(url.port || ECP_PORT),
    location,
    macs
  };
}

async function fetchDeviceInfo(location) {
  const base = new URL(location);
  const infoUrl = new URL("/query/device-info", base);
  const response = await fetch(infoUrl, { signal: AbortSignal.timeout(2200) });
  if (!response.ok) {
    throw new Error(`Roku returned HTTP ${response.status}.`);
  }
  return deviceFromXml(infoUrl.toString(), await response.text());
}

function discoverRokus() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const found = new Map();
    const message = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        "MAN: \"ssdp:discover\"",
        "MX: 2",
        `ST: ${ROKU_ST}`,
        "",
        ""
      ].join("\r\n")
    );

    const finish = () => {
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // Socket may already be closed after an error.
      }
      resolve(Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name)));
    };

    socket.on("message", (buffer) => {
      const headers = parseHeaders(buffer.toString("utf8"));
      const location = headers.location;
      if (!location || found.has(location)) {
        return;
      }

      found.set(location, {
        id: location,
        name: "Roku device",
        modelName: "Checking...",
        host: new URL(location).hostname,
        port: ECP_PORT,
        location,
        macs: []
      });

      fetchDeviceInfo(location)
        .then((device) => found.set(location, device))
        .catch(() => undefined);
    });

    socket.once("error", finish);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(message, 0, message.length, 1900, "239.255.255.250");
      setTimeout(finish, DISCOVERY_TIMEOUT_MS);
    });
  });
}

async function sendKey(device, key) {
  if (!device || !device.host) {
    throw new Error("Connect to a Roku before sending keys.");
  }

  const safeKey = String(key).replace(/[^A-Za-z0-9_]/g, "");
  const url = `http://${device.host}:${device.port || ECP_PORT}/keypress/${safeKey}`;
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(2200) });
  if (!response.ok) {
    throw new Error(`${safeKey} failed with HTTP ${response.status}.`);
  }
  return { ok: true };
}

async function sendText(device, text) {
  if (!text) {
    return { ok: true };
  }

  const url = `http://${device.host}:${device.port || ECP_PORT}/keypress/Lit_${encodeURIComponent(text)}`;
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`Text send failed with HTTP ${response.status}.`);
  }
  return { ok: true };
}

function sendWakeOnLan(mac) {
  return new Promise((resolve) => {
    const bytes = mac.split(":").map((part) => Number.parseInt(part, 16));
    const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => Buffer.from(bytes))]);
    const socket = dgram.createSocket("udp4");
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, 9, "255.255.255.255", () => {
        socket.close();
        resolve(true);
      });
    });
    socket.once("error", () => resolve(false));
  });
}

async function wakeDevice(device) {
  const macResults = [];
  for (const mac of device?.macs || []) {
    macResults.push(await sendWakeOnLan(mac));
  }

  try {
    await sendKey(device, "PowerOn");
    return { ok: true, method: macResults.some(Boolean) ? "wake-on-lan + PowerOn" : "PowerOn" };
  } catch (error) {
    if (macResults.some(Boolean)) {
      return { ok: true, method: "wake-on-lan" };
    }
    throw error;
  }
}

function voicePhrases() {
  const base = [
    "power on",
    "power off",
    "turn on",
    "turn off",
    "wake tv",
    "go home",
    "home",
    "back",
    "go back",
    "select",
    "ok",
    "enter",
    "pause",
    "play",
    "play pause",
    "mute",
    "search",
    "menu",
    "options",
    "replay",
    "rewind",
    "fast forward",
    "forward",
    "channel up",
    "channel down",
    "volume up",
    "volume down",
    "turn volume up",
    "turn volume down",
    "input tuner",
    "hdmi one",
    "hdmi two",
    "hdmi three",
    "hdmi four"
  ];
  const directions = ["up", "down", "left", "right"];
  const counts = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const expanded = [];
  for (const direction of directions) {
    expanded.push(direction, `go ${direction}`, `move ${direction}`, `press ${direction}`);
    for (const count of counts) {
      expanded.push(`${direction} ${count}`, `go ${direction} ${count}`, `move ${direction} ${count}`, `press ${direction} ${count}`);
    }
  }
  for (const count of counts) {
    expanded.push(`volume up ${count}`, `volume down ${count}`, `channel up ${count}`, `channel down ${count}`);
  }
  return [...base, ...expanded];
}

function powershellArray(values) {
  return values.map((value) => `"${value.replace(/"/g, "`\"")}"`).join(",");
}

function startVoiceRecognition(event) {
  if (process.platform !== "win32") {
    throw new Error("Live voice mode uses Windows Speech Recognition and needs Windows.");
  }
  if (voiceProcess) {
    return { ok: true, listening: true };
  }

  voiceOwner = event.sender;
  const phrases = powershellArray(voicePhrases());
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$phrases = @(${phrases})
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$choices = New-Object System.Speech.Recognition.Choices
$choices.Add([string[]]$phrases) | Out-Null
$builder = New-Object System.Speech.Recognition.GrammarBuilder
$builder.Append($choices)
$grammar = New-Object System.Speech.Recognition.Grammar($builder)
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToDefaultAudioDevice()
$recognizer.add_SpeechRecognized({
  param($sender, $eventArgs)
  $confidence = [Math]::Round($eventArgs.Result.Confidence, 3)
  if ($confidence -ge 0.48) {
    [Console]::Out.WriteLine("VOICE" + [char]9 + $confidence + [char]9 + $eventArgs.Result.Text)
    [Console]::Out.Flush()
  }
})
[Console]::Out.WriteLine("READY" + [char]9 + "Windows speech grammar loaded")
[Console]::Out.Flush()
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
while ($true) { Start-Sleep -Milliseconds 250 }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  voiceProcess = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    windowsHide: true
  });

  voiceProcess.stdout.on("data", (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const [kind, confidence, text] = line.split("\t");
      if (kind === "VOICE") {
        voiceOwner?.send("roku:voice-result", { type: "command", confidence: Number(confidence), text });
      } else if (kind === "READY") {
        voiceOwner?.send("roku:voice-result", { type: "ready", text: confidence || "Voice ready" });
      }
    }
  });

  voiceProcess.stderr.on("data", (chunk) => {
    voiceOwner?.send("roku:voice-result", { type: "error", text: chunk.toString("utf8").trim() });
  });

  voiceProcess.once("exit", () => {
    voiceOwner?.send("roku:voice-result", { type: "stopped", text: "Voice stopped" });
    voiceProcess = null;
    voiceOwner = null;
  });

  return { ok: true, listening: true };
}

function stopVoiceRecognition() {
  if (voiceProcess) {
    voiceProcess.kill();
    voiceProcess = null;
  }
  voiceOwner = null;
  return { ok: true, listening: false };
}

ipcMain.handle("roku:discover", discoverRokus);
ipcMain.handle("roku:connect", async (_event, target) => fetchDeviceInfo(normalizeDeviceTarget(target).toString()));
ipcMain.handle("roku:key", (_event, device, key) => sendKey(device, key));
ipcMain.handle("roku:text", (_event, device, text) => sendText(device, text));
ipcMain.handle("roku:wake", (_event, device) => wakeDevice(device));
ipcMain.handle("roku:voice-start", startVoiceRecognition);
ipcMain.handle("roku:voice-stop", stopVoiceRecognition);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  stopVoiceRecognition();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
