package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

//go:embed static
var staticFS embed.FS

// Message is the single WS envelope dispatched by type in handleConn.
type Message struct {
	Type        string   `json:"type"`
	DX          int      `json:"dx"`
	DY          int      `json:"dy"`
	Sensitivity float64  `json:"sensitivity"`
	Button      string   `json:"button"`
	Double      bool     `json:"double"`
	Key         string   `json:"key"`
	Modifiers   []string `json:"modifiers"`
	Value       string   `json:"value"`
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	initInput()

	// systray.Run must own the main goroutine on macOS (it drives the Cocoa
	// run loop for the status bar item), so the HTTP server and pairing
	// loop are started from within it as goroutines instead of here.
	runTray(cfg, newPairingState(cfg))
}

func startServer(cfg Config) {
	mux := http.NewServeMux()

	// Static control app + setup page, served from the embedded FS.
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	// WebSocket endpoint for live input. Token is checked at handshake.
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWS(w, r, cfg)
	})

	addr := "0.0.0.0:" + strconv.Itoa(cfg.Port)
	log.Printf("remoteconnector listening on http://0.0.0.0:%d", cfg.Port)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

func handleWS(w http.ResponseWriter, r *http.Request, cfg Config) {
	// Verify shared token from the query string before accepting.
	token := r.URL.Query().Get("token")
	if token == "" || token != cfg.Token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("accept: %v", err)
		return
	}
	defer func() {
		_ = conn.Close(websocket.StatusNormalClosure, "session ended")
	}()

	log.Printf("session connected")

	ctx := r.Context()
	for {
		var msg Message
		err := wsjson.Read(ctx, conn, &msg)
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusNormalClosure {
				log.Printf("read: %v", err)
			}
			return
		}
		dispatch(msg)
	}
}

func dispatch(msg Message) {
	switch msg.Type {
	case "move":
		doMove(msg.DX, msg.DY, msg.Sensitivity)
	case "click":
		doClick(msg.Button, msg.Double)
	case "scroll":
		doScroll(msg.DX, msg.DY)
	case "key":
		doKeyTap(msg.Key, msg.Modifiers)
	case "text":
		doType(msg.Value)
	case "end":
		doEnd()
	default:
		log.Printf("unknown message type: %q", msg.Type)
	}
}
