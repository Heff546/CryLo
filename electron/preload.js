'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('c64', {
  // ── RPC ──────────────────────────────────────────────────────────────
  daemonRpc:   (method, params)  => ipcRenderer.invoke('daemon-rpc',   method, params),
  walletRpc:   (method, params, timeout)  => ipcRenderer.invoke('wallet-rpc', method, params, timeout),
  // ── Local helpers ─────────────────────────────────────────────────────
  listWallets: ()                => ipcRenderer.invoke('list-wallets'),
  openLogDir:  ()                => ipcRenderer.invoke('open-log-dir'),
  openDataDir: ()                => ipcRenderer.invoke('open-data-dir'),
  getVersion:  ()                => ipcRenderer.invoke('get-version'),
  confirm:     (opts)            => ipcRenderer.invoke('confirm-dialog', opts),
  // ── Miner ─────────────────────────────────────────────────────────────
  minerStart:     (opts)         => ipcRenderer.invoke('miner-start', opts),
  minerStop:      ()             => ipcRenderer.invoke('miner-stop'),
  minerGetStatus: ()             => ipcRenderer.invoke('miner-get-status'),
  minerGetInfo:   ()             => ipcRenderer.invoke('miner-get-info'),
  // ── Nexus ─────────────────────────────────────────────────────────────
  nexusScanNfts: (linkedAddress) =>
    ipcRenderer.invoke('nexus-scan-nfts', linkedAddress),

  nexusBuyBackNft: (tokenId) =>
    ipcRenderer.invoke('nexus-buyback-nft', tokenId),
  // ── Events (main → renderer) ──────────────────────────────────────────
  onStartupStatus: (cb)          => ipcRenderer.on('startup-status', (_, data) => cb(data)),
  onLog:           (cb)          => ipcRenderer.on('log',            (_, data) => cb(data)),
  onDaemonExit:    (cb)          => ipcRenderer.on('daemon-exit',    (_, code) => cb(code)),
  onWalletRpcExit: (cb)          => ipcRenderer.on('wallet-rpc-exit',(_, code) => cb(code)),
  // ── Cleanup ───────────────────────────────────────────────────────────
  removeAllListeners: (channel)  => ipcRenderer.removeAllListeners(channel)
});
