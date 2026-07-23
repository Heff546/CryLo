'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crylo', {
  // ── RPC ──────────────────────────────────────────────────────────────
  daemonRpc:   (method, params)  => ipcRenderer.invoke('daemon-rpc',   method, params),
  walletRpc:   (method, params, timeout)  => ipcRenderer.invoke('wallet-rpc', method, params, timeout),
  // ── Local helpers ─────────────────────────────────────────────────────
  listWallets: ()                => ipcRenderer.invoke('list-wallets'),
  nexusWalletCreate: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-wallet-create', walletName, cryloAddress),
  nexusWalletLoad: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-wallet-load', walletName, cryloAddress),

  nexusRuntimeStatus: () =>
    ipcRenderer.invoke('nexus-runtime-status'),
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

  nexusBuyBackNft: (tokenId, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-buyback-nft', tokenId, walletName, cryloAddress),

  nexusBurnNft: (tokenId, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-burn-nft', tokenId, walletName, cryloAddress),

  nexusGasStatus: (linkedAddress) =>
    ipcRenderer.invoke('nexus-gas-status', linkedAddress),

  nexusTransactions: (linkedAddress) =>
    ipcRenderer.invoke('nexus-transactions', linkedAddress),

  nexusClaimDailyGas: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-claim-daily-gas', walletName, cryloAddress),

  nexusBuyGasWithWcrylo: (amountText, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-buy-gas-wcrylo', amountText, walletName, cryloAddress),

  nexusWcryloBalance: (linkedAddress) =>
    ipcRenderer.invoke('nexus-wcrylo-balance', linkedAddress),

  nexusStakedBalance: (linkedAddress) =>
    ipcRenderer.invoke('nexus-staked-balance', linkedAddress),

  nexusStakeWcrylo: (amountText, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-stake-wcrylo', amountText, walletName, cryloAddress),

    nexusPendingRewards: (linkedAddress) =>
    ipcRenderer.invoke('nexus-pending-rewards', linkedAddress),

  nexusClaimRewards: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-claim-rewards', walletName, cryloAddress),

  nexusUnstakeWcrylo: (amountText, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-unstake-wcrylo', amountText, walletName, cryloAddress),

    nexusNodeStatus: (linkedAddress) =>
    ipcRenderer.invoke('nexus-node-status', linkedAddress),

  nexusRegisterOperator: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-register-operator', walletName, cryloAddress),

  nexusRegisterValidator: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-register-validator', walletName, cryloAddress),

  nexusUnregisterNode: (walletName, cryloAddress) => ipcRenderer.invoke('nexus-unregister-node', walletName, cryloAddress),
    nexusClaimNodeRewards: (walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-claim-node-rewards', walletName, cryloAddress),

  // ── CryLo Bridge ──────────────────────────────────────────────────────
  bridgeRequest: (payload) =>
    ipcRenderer.invoke('bridge-request', payload),

  bridgeStatus: (paymentId) =>
    ipcRenderer.invoke('bridge-status', paymentId),

  bridgeReleaseStatus: (nexusTxHash) =>
    ipcRenderer.invoke('bridge-release-status', nexusTxHash),

  nexusBurnForCryLo: (amountText, walletName, cryloAddress) =>
    ipcRenderer.invoke('nexus-burn-for-crylo', amountText, walletName, cryloAddress),

  // ── Events (main → renderer) ──────────────────────────────────────────
  onStartupStatus: (cb)          => ipcRenderer.on('startup-status', (_, data) => cb(data)),
  onLog:           (cb)          => ipcRenderer.on('log',            (_, data) => cb(data)),
  onDaemonExit:    (cb)          => ipcRenderer.on('daemon-exit',    (_, code) => cb(code)),
  onWalletRpcExit: (cb)          => ipcRenderer.on('wallet-rpc-exit',(_, code) => cb(code)),
  // ── Cleanup ───────────────────────────────────────────────────────────
  removeAllListeners: (channel)  => ipcRenderer.removeAllListeners(channel)
});
