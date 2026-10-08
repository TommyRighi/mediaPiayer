package main

import (
	"bytes"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"tailscale.com/ipn"
	"testing"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestTarget(t *testing.T) {
	for _, s := range []string{"http://pi.tail.ts.net", "https://127.0.0.1", "https://pi.tail.ts.net.evil.com", "https://user:pass@pi.tail.ts.net", "https://pi.tail.ts.net/api", "https://pi.tail.ts.net?token=x"} {
		if _, err := validateTarget(s); err == nil {
			t.Fatal(s)
		}
	}
	if _, err := validateTarget("https://pi.tail.ts.net"); err != nil {
		t.Fatal(err)
	}
}
func TestProxyBoundaryAndStreaming(t *testing.T) {
	target, _ := url.Parse("https://pi.tail.ts.net")
	capability := strings.Repeat("a", 64)
	calls := 0
	h := proxyHandler(target, "127.0.0.1:23456", capability, roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Host != "pi.tail.ts.net" || r.URL.Host != "pi.tail.ts.net" {
			t.Fatal("wrong target")
		}
		if r.Header.Get("X-Desktop-Capability") != "" || r.Header.Get("X-Forwarded-For") != "" {
			t.Fatal("credential or spoofed identity forwarded")
		}
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Fatal("range lost")
		}
		headers := http.Header{"Content-Range": []string{"bytes 0-3/8"}, "Set-Cookie": []string{"mp_session=test; HttpOnly; Secure; SameSite=Strict; Path=/api"}}
		headers.Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' wss://pi.tail.ts.net https://pi.tail.ts.net; upgrade-insecure-requests")
		return &http.Response{StatusCode: 206, Header: headers, Body: io.NopCloser(strings.NewReader("data"))}, nil
	}))
	for _, mode := range []string{"missing-capability", "wrong-host", "wrong-origin", "good"} {
		r := httptest.NewRequest("GET", "/api/media/x/video", nil)
		r.Host = "127.0.0.1:23456"
		r.Header.Set("Range", "bytes=0-3")
		r.Header.Set("X-Forwarded-For", "spoofed")
		if mode != "missing-capability" {
			r.Header.Set("X-Desktop-Capability", capability)
		}
		if mode == "wrong-host" {
			r.Host = "evil.example"
		}
		if mode == "wrong-origin" {
			r.Header.Set("Origin", "https://evil.example")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if mode == "good" {
			if w.Code != 206 || w.Body.String() != "data" {
				t.Fatal(w)
			}
			c := w.Result().Cookies()[0]
			if !c.HttpOnly || c.Secure || c.Domain != "" {
				t.Fatal(c)
			}
			csp := w.Header().Get("Content-Security-Policy")
			if strings.Contains(csp, "pi.tail.ts.net") || strings.Contains(csp, "upgrade-insecure-requests") || !strings.Contains(csp, "ws://127.0.0.1:23456") || !strings.Contains(csp, "http://127.0.0.1:23456") {
				t.Fatal("incorrect loopback CSP", csp)
			}
		} else if w.Code != 403 {
			t.Fatal(mode, w.Code)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
}
func TestEncryptedStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.enc")
	key := make([]byte, 32)
	rand.Read(key)
	s, err := newStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("private-node-key-fixture")
	if err = s.WriteState(ipn.StateKey("test"), secret); err != nil {
		t.Fatal(err)
	}
	disk, _ := os.ReadFile(path)
	if bytes.Contains(disk, secret) {
		t.Fatal("plaintext on disk")
	}
	reopened, err := newStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	value, err := reopened.ReadState("test")
	if err != nil || !bytes.Equal(value, secret) {
		t.Fatal("roundtrip failed")
	}
	wrong := make([]byte, 32)
	if _, err = newStore(path, wrong); err == nil {
		t.Fatal("wrong key accepted")
	}
	if err = reopened.WriteState("test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err = reopened.ReadState("test"); err != ipn.ErrStateNotExist {
		t.Fatal("delete failed")
	}
}
