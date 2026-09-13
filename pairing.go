package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

// pairing.go registers this Mac's {code -> LAN IP, port, token} with the
// small Vercel API (see pairing-web/) so a phone can find it by typing a
// short code instead of needing the LAN IP and token in a bookmarked URL.
// The actual control traffic (WebSocket, mouse/keyboard) never goes through
// Vercel -- the phone is redirected straight to this Mac's LAN address after
// resolving the code. Registration re-runs on an interval, rotating the code
// each time, so a code is only ever valid for a short window.

const (
	codeTTL       = 10 * time.Minute
	registerEvery = 4 * time.Minute
)

// pairingState is read by the tray UI to display the current code/status.
type pairingState struct {
	code    string
	enabled bool
	lastErr error
}

func newPairingState(cfg Config) *pairingState {
	return &pairingState{enabled: cfg.PairServerURL != ""}
}

// runPairing loops forever, registering a fresh code with the pairing server
// every registerEvery. It's a no-op if PairServerURL isn't configured.
func runPairing(cfg Config, state *pairingState, onUpdate func()) {
	if cfg.PairServerURL == "" {
		log.Printf("pairing: RC_PAIR_SERVER_URL / PAIR_SERVER_URL not set, skipping (phone must use the direct LAN URL)")
		return
	}
	for {
		code := generateCode()
		ip, err := localLANIP()
		if err != nil {
			state.lastErr = err
			log.Printf("pairing: could not determine LAN IP: %v", err)
		} else if err := register(cfg, code, ip); err != nil {
			state.lastErr = err
			log.Printf("pairing: register failed: %v", err)
		} else {
			state.code = code
			state.lastErr = nil
			log.Printf("pairing: registered code %s (lan %s:%d)", code, ip, cfg.Port)
		}
		if onUpdate != nil {
			onUpdate()
		}
		time.Sleep(registerEvery)
	}
}

type registerPayload struct {
	Code   string `json:"code"`
	LANIP  string `json:"lanIp"`
	Port   int    `json:"port"`
	Token  string `json:"token"`
	Name   string `json:"name"`
	TTLSec int    `json:"ttlSeconds"`
}

func register(cfg Config, code, lanIP string) error {
	payload := registerPayload{
		Code:   code,
		LANIP:  lanIP,
		Port:   cfg.Port,
		Token:  cfg.Token,
		Name:   cfg.DeviceName,
		TTLSec: int(codeTTL.Seconds()),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, cfg.PairServerURL+"/api/register", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Register-Secret", cfg.PairSecret)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pairing server returned %s", resp.Status)
	}
	return nil
}

// localLANIP returns this machine's LAN IPv4 address by asking the kernel
// which local address it would use to reach the public internet. No packets
// are actually sent for a UDP "connect".
func localLANIP() (string, error) {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return "", err
	}
	defer conn.Close()
	addr := conn.LocalAddr().(*net.UDPAddr)
	return addr.IP.String(), nil
}

// generateCode returns a 6-digit numeric pairing code, e.g. "042817".
func generateCode() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1000000
	return fmt.Sprintf("%06d", n)
}
