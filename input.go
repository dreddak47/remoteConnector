package main

import (
	"log"

	"github.com/go-vgo/robotgo"
)

// input.go maps WS message types to robotgo calls. Movement deltas from the
// phone (CSS pixels) are passed straight through to MoveRelative, optionally
// scaled by a sensitivity multiplier supplied by the client. robotgo's
// MoveRelative already works in the correct coordinate space, so no Retina
// division is applied here — that would double-scale and make the cursor slow.

// initInput is a no-op placeholder kept for diagnostics; no per-frame scale
// adjustment is needed for relative movement.
func initInput() {
	w, h := robotgo.GetScaleSize()
	log.Printf("input: display scale %dx%d", w, h)
}

// doMove moves the cursor relative to its current position, applying the
// client-supplied sensitivity factor (defaults to 1.0).
func doMove(dx, dy int, sensitivity float64) {
	if sensitivity <= 0 {
		sensitivity = 1.0
	}
	sx := int(float64(dx) * sensitivity)
	sy := int(float64(dy) * sensitivity)
	if dx != 0 && sx == 0 {
		sx = sign(dx)
	}
	if dy != 0 && sy == 0 {
		sy = sign(dy)
	}
	robotgo.MoveRelative(sx, sy)
}

func doClick(button string, double bool) {
	btn := "left"
	if button == "right" || button == "center" {
		btn = button
	}
	if err := robotgo.Click(btn, double); err != nil {
		log.Printf("click error: %v", err)
	}
}

func doScroll(dx, dy int) {
	robotgo.Scroll(dx, dy)
}

func doKeyTap(key string, modifiers []string) {
	if len(modifiers) > 0 {
		robotgo.KeyTap(key, modifiers)
		return
	}
	if err := robotgo.KeyTap(key); err != nil {
		log.Printf("key error: %v", err)
	}
}

func doType(text string) {
	robotgo.TypeStr(text)
}

func doEnd() {
	// No server-side state to tear down; the connection is closed by the
	// caller and the daemon stays resident, ready for the next session.
}

func sign(v int) int {
	if v < 0 {
		return -1
	}
	return 1
}
