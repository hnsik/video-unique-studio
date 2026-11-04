"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("videoUniqueDesktop", {
  version: "2.1.0",
  getStatus: () => invoke("tools:status"),
  retryTools: () => invoke("tools:retry"),
  chooseTools: () => invoke("tools:choose"),
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("tools:update", listener);
    return () => ipcRenderer.removeListener("tools:update", listener);
  },
  openSession: () => invoke("native:create"),
  write: (id, name, data, offset) =>
    invoke("native:write", id, name, data, offset),
  stat: (id, name) => invoke("native:stat", id, name),
  read: (id, name, offset, length, encoding) =>
    invoke("native:read", id, name, offset, length, encoding),
  remove: (id, name) => invoke("native:remove", id, name),
  run: (id, kind, args, timeout) =>
    invoke("native:run", id, kind, args, timeout),
  closeSession: (id) => invoke("native:close", id),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("native:progress", listener);
    return () => ipcRenderer.removeListener("native:progress", listener);
  },
  openResults: () => invoke("results:open"),
  selfTestFixture: () => invoke("selftest:fixture"),
  selfTestFinish: (result) => invoke("selftest:finish", result),
});
