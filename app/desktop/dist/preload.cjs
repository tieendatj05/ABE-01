"use strict";

// app/desktop/preload.ts
var import_electron = require("electron"), call = (c, a) => import_electron.ipcRenderer.invoke(c, a);
import_electron.contextBridge.exposeInMainWorld("medabe", {
  desktop: !0,
  network: {
    allowed: (base) => call("network:allowed", base),
    discover: () => call("network:discover"),
    probe: (base) => call("network:probe", base)
  },
  hardware: () => call("hw:info"),
  loadDevice: () => call("device:load"),
  saveDevice: (d) => call("device:save", d),
  getVault: () => call("vault:get"),
  setVault: (v) => call("vault:set", v),
  wipe: () => call("vault:wipe"),
  autoPass: { get: () => call("autounlock:get"), set: (p) => call("autounlock:set", p), clear: () => call("autounlock:clear") },
  getSetting: (k) => call("setting:get", k),
  setSetting: (k, v) => call("setting:set", { k, v }),
  quit: () => call("app:quit"),
  update: {
    localHash: () => call("update:localHash"),
    apply: (storageBase) => call("update:apply", storageBase)
  }
});
