package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// Config holds runtime configuration for the helper.
type Config struct {
	Token string
	Port  int

	// Pairing lets the phone find this Mac via a short code instead of a
	// LAN IP + token in the URL. PairServerURL points at the small Vercel
	// API that brokers code -> {lanIP, token} lookups; PairSecret
	// authenticates this Mac's registrations with that API (must match the
	// REGISTER_SECRET env var configured on the Vercel project). Pairing is
	// disabled (no registration loop, no tray code display) when
	// PairServerURL is empty.
	PairServerURL string
	PairSecret    string
	DeviceName    string
}

// default values
const (
	defaultPort = 8740
)

// LoadConfig reads the shared token and port from the environment or a small
// local config file. Precedence: environment variables override the file,
// which overrides defaults.
func LoadConfig() (Config, error) {
	cfg := Config{
		Token: "",
		Port:  defaultPort,
	}

	// Local config file (single file, kept in the user's home directory).
	home, _ := os.UserHomeDir()
	confPath := ""
	if home != "" {
		confPath = filepath.Join(home, ".remoteconnector.conf")
		if data, rerr := os.ReadFile(confPath); rerr == nil {
			parseConfigFile(string(data), &cfg)
		}
	}

	// Environment overrides.
	if v := os.Getenv("RC_TOKEN"); v != "" {
		cfg.Token = v
	}
	if v := os.Getenv("RC_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p < 65536 {
			cfg.Port = p
		}
	}
	if v := os.Getenv("RC_PAIR_SERVER_URL"); v != "" {
		cfg.PairServerURL = v
	}
	if v := os.Getenv("RC_PAIR_SECRET"); v != "" {
		cfg.PairSecret = v
	}
	if v := os.Getenv("RC_DEVICE_NAME"); v != "" {
		cfg.DeviceName = v
	}

	// Auto-generate and persist anything still missing, so the config file
	// ends up with a stable identity across restarts instead of a fresh
	// token/secret every launch (which would silently break pairing and
	// invalidate any bookmarked phone URL).
	dirty := false
	if cfg.Token == "" {
		cfg.Token = generateToken()
		fmt.Fprintf(os.Stdout, "generated token: %s\n", cfg.Token)
		dirty = true
	}
	if cfg.PairSecret == "" {
		cfg.PairSecret = generateToken()
		dirty = true
	}
	if cfg.DeviceName == "" {
		if h, err := os.Hostname(); err == nil && h != "" {
			cfg.DeviceName = h
		} else {
			cfg.DeviceName = "Mac"
		}
		dirty = true
	}

	if dirty && confPath != "" {
		_ = os.WriteFile(confPath, []byte(cfg.toConfFile()), 0o600)
	}

	return cfg, nil
}

func (cfg Config) toConfFile() string {
	s := "TOKEN=" + cfg.Token + "\n"
	s += "PORT=" + strconv.Itoa(cfg.Port) + "\n"
	s += "PAIR_SECRET=" + cfg.PairSecret + "\n"
	s += "DEVICE_NAME=" + cfg.DeviceName + "\n"
	if cfg.PairServerURL != "" {
		s += "PAIR_SERVER_URL=" + cfg.PairServerURL + "\n"
	}
	return s
}

func parseConfigFile(contents string, cfg *Config) {
	lines := splitLines(contents)
	for _, line := range lines {
		if len(line) < 3 {
			continue
		}
		// Support KEY=VALUE.
		for i := 0; i < len(line); i++ {
			if line[i] == '=' {
				key := line[:i]
				val := line[i+1:]
				switch key {
				case "TOKEN":
					if val != "" {
						cfg.Token = val
					}
				case "PORT":
					if p, err := strconv.Atoi(val); err == nil && p > 0 && p < 65536 {
						cfg.Port = p
					}
				case "PAIR_SERVER_URL":
					cfg.PairServerURL = val
				case "PAIR_SECRET":
					cfg.PairSecret = val
				case "DEVICE_NAME":
					cfg.DeviceName = val
				}
				break
			}
		}
	}
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

func generateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
