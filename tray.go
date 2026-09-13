package main

import (
	"fmt"

	"github.com/getlantern/systray"
)

// tray.go owns the menu bar icon: it shows the current pairing code (or the
// direct LAN URL when pairing isn't configured) and a quit item. All actual
// work (HTTP server, pairing loop) runs in goroutines started from onReady;
// systray.Run blocks the main goroutine for the lifetime of the app, which
// is required on macOS since the status item needs the main-thread run loop.
func runTray(cfg Config, state *pairingState) {
	onReady := func() {
		systray.SetTitle("RC")
		systray.SetTooltip("RemoteConnector")

		codeItem := systray.AddMenuItem("Code: ----", "Pairing code, shown on the connect page")
		codeItem.Disable()
		statusItem := systray.AddMenuItem("Starting…", "Pairing status")
		statusItem.Disable()
		systray.AddSeparator()
		deviceItem := systray.AddMenuItem(fmt.Sprintf("Device: %s", cfg.DeviceName), "")
		deviceItem.Disable()
		portItem := systray.AddMenuItem(fmt.Sprintf("Port: %d", cfg.Port), "")
		portItem.Disable()
		systray.AddSeparator()
		quitItem := systray.AddMenuItem("Quit", "Stop RemoteConnector")

		go startServer(cfg)

		if state.enabled {
			go runPairing(cfg, state, func() {
				if state.lastErr != nil {
					codeItem.SetTitle("Code: (error)")
					statusItem.SetTitle("Status: " + state.lastErr.Error())
					return
				}
				codeItem.SetTitle("Code: " + state.code)
				statusItem.SetTitle("Status: registered, refreshes every few min")
			})
		} else {
			codeItem.SetTitle("Pairing not configured")
			statusItem.SetTitle("Set PAIR_SERVER_URL to enable")
		}

		go func() {
			<-quitItem.ClickedCh
			systray.Quit()
		}()
	}

	onExit := func() {}

	systray.Run(onReady, onExit)
}
