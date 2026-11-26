# JARVIS Desktop runtime

The Electron main process serves the Vite production build from a loopback-only HTTP origin and starts the existing local bridge in the same Node-enabled main process. The renderer has no Node integration, is context-isolated and sandboxed, and receives media permission only for the exact local app origin.

The bridge is imported only after the app selects its loopback port and sets its WebSocket origin allowlist. It is not exposed to the LAN. External HTTP and HTTPS links are opened in the system browser; navigation away from the local interface is blocked.

Build the Windows x64 installer with npm run dist:win. The installer is generated in release/.
