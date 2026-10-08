package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sync"
	"tailscale.com/tsnet"
	"time"
)

type config struct {
	Target     string `json:"target"`
	AuthKey    string `json:"authKey"`
	StateDir   string `json:"stateDir"`
	StateKey   string `json:"stateKey"`
	Capability string `json:"capability"`
	Hostname   string `json:"hostname"`
}

var outputMu sync.Mutex

func event(kind, value string) {
	outputMu.Lock()
	defer outputMu.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"type": kind, "value": value})
}

func run() error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 16384), 32768)
	if !scanner.Scan() {
		return fmt.Errorf("missing configuration")
	}
	var cfg config
	if err := json.Unmarshal(scanner.Bytes(), &cfg); err != nil {
		return fmt.Errorf("invalid configuration")
	}
	target, err := validateTarget(cfg.Target)
	if err != nil {
		return err
	}
	if len(cfg.Capability) < 64 || !filepath.IsAbs(cfg.StateDir) {
		return fmt.Errorf("invalid local configuration")
	}
	key, err := base64.StdEncoding.DecodeString(cfg.StateKey)
	if err != nil {
		return fmt.Errorf("invalid state key")
	}
	store, err := newStore(filepath.Join(cfg.StateDir, "state.enc"), key)
	if err != nil {
		return err
	}
	for i := range key {
		key[i] = 0
	}
	cfg.StateKey = ""
	if err = os.MkdirAll(cfg.StateDir, 0700); err != nil {
		return err
	}
	// tsnet log upload is explicitly disabled; never publish enrollment URLs or keys.
	os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	s := &tsnet.Server{Hostname: cfg.Hostname, Dir: cfg.StateDir, Store: store, AuthKey: cfg.AuthKey,
		UserLogf: func(format string, args ...any) {
			message := fmt.Sprintf(format, args...)
			authURL := regexp.MustCompile(`https://login\.tailscale\.com/[A-Za-z0-9/_?=&.-]+`).FindString(message)
			if authURL != "" {
				event("auth-url", authURL)
			}
		},
	}
	defer s.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	// Closing stdin also stops the helper if Electron dies.
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	event("status", "connecting")
	upCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	_, err = s.Up(upCtx)
	cancel()
	s.AuthKey = ""
	cfg.AuthKey = ""
	if err != nil {
		return fmt.Errorf("collegamento non riuscito: verifica chiave, approvazione dispositivo e rete")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	transport := &http.Transport{DialContext: s.Dial, ForceAttemptHTTP2: false, ResponseHeaderTimeout: 30 * time.Second, TLSHandshakeTimeout: 15 * time.Second, MaxIdleConns: 32}
	defer transport.CloseIdleConnections()
	server := &http.Server{Handler: proxyHandler(target, listener.Addr().String(), cfg.Capability, transport), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 16}
	go func() { <-ctx.Done(); _ = server.Close() }()
	event("ready", "http://"+listener.Addr().String())
	err = server.Serve(listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
func main() {
	if err := run(); err != nil {
		event("error", err.Error())
		os.Exit(1)
	}
}
