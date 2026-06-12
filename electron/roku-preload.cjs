const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rokuRemote", {
  discover: () => ipcRenderer.invoke("roku:discover"),
  connect: (target) => ipcRenderer.invoke("roku:connect", target),
  sendKey: (device, key) => ipcRenderer.invoke("roku:key", device, key),
  sendText: (device, text) => ipcRenderer.invoke("roku:text", device, text),
  wake: (device) => ipcRenderer.invoke("roku:wake", device)
});
