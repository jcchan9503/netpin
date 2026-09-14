'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Renderer receives neither Node.js nor a generic IPC/channel primitive.
const methods = new Set(['state', 'resetDemo', 'saveCredential', 'deleteCredential', 'saveDevice', 'deleteDevice', 'saveSubnet', 'deleteSubnet', 'saveAssignment', 'subnetView', 'deviceView', 'history', 'search', 'startCollect', 'startScan', 'cancel', 'exportCsv', 'importDevices', 'switchMode']);
contextBridge.exposeInMainWorld('netpin', {
  async invoke(method, payload = {}) {
    if (!methods.has(method)) throw new Error('不允许的操作');
    const response = await ipcRenderer.invoke('netpin:request', method, payload);
    if (response.error) throw new Error(response.error); return response.result;
  }
});
