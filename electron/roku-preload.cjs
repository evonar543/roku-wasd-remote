const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rokuRemote", {
  discover: () => ipcRenderer.invoke("roku:discover"),
  connect: (target) => ipcRenderer.invoke("roku:connect", target),
  sendKey: (device, key) => ipcRenderer.invoke("roku:key", device, key),
  sendText: (device, text) => ipcRenderer.invoke("roku:text", device, text),
  wake: (device) => ipcRenderer.invoke("roku:wake", device),
  startVoice: () => ipcRenderer.invoke("roku:voice-start"),
  stopVoice: () => ipcRenderer.invoke("roku:voice-stop"),
  onVoiceResult: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("roku:voice-result", listener);
    return () => ipcRenderer.removeListener("roku:voice-result", listener);
  }
});
