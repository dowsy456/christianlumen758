'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ringPopup', Object.freeze({
  onState(callback) { const listener = (_event, state) => callback(state); ipcRenderer.on('chat-rings:state', listener); return () => ipcRenderer.removeListener('chat-rings:state', listener); },
  command: command => ipcRenderer.invoke('chat-rings:answer', command),
  layout: regions => ipcRenderer.send('chat-rings:layout', regions),
  pointer: point => ipcRenderer.sendSync('chat-rings:pointer', point),
  onHover(callback) { const listener = (_event, value) => callback(value); ipcRenderer.on('chat-rings:hover', listener); return () => ipcRenderer.removeListener('chat-rings:hover', listener); },
}));
