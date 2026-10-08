package main

import (
	"crypto/subtle"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
)

var targetHost = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$`)

func validateTarget(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !targetHost.MatchString(u.Hostname()) ||
		u.User != nil || (u.Port() != "" && u.Port() != "443") || (u.Path != "" && u.Path != "/") ||
		u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("use the HTTPS .ts.net address provided by the administrator")
	}
	u.Path = ""
	return u, nil
}

func proxyHandler(target *url.URL, localHost, capability string, transport http.RoundTripper) http.Handler {
	localOrigin := "http://" + localHost
	p := &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1,
		ErrorLog:      log.New(io.Discard, "", 0),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
			// Never forward local capabilities, referrers or spoofed proxy identity.
			pr.Out.Header.Del("X-Desktop-Capability")
			pr.Out.Header.Del("Referer")
			pr.Out.Header.Del("Forwarded")
			pr.Out.Header.Del("X-Forwarded-For")
			pr.Out.Header.Del("X-Forwarded-Host")
			pr.Out.Header.Del("X-Forwarded-Proto")
			pr.Out.Header.Del("Tailscale-User-Login")
			pr.Out.Header.Del("Tailscale-User-Name")
			if pr.In.Header.Get("Origin") != "" {
				pr.Out.Header.Set("Origin", target.Scheme+"://"+target.Host)
			}
		},
		ModifyResponse: func(r *http.Response) error {
			r.Header.Del("Alt-Svc")
			// HTTPS remains verified end-to-end to the Pi. The local endpoint is
			// capability-protected loopback, in an ephemeral Electron session.
			r.Header.Del("Strict-Transport-Security")
			cookies := r.Cookies()
			r.Header.Del("Set-Cookie")
			for _, c := range cookies {
				c.Domain = ""
				c.Secure = false
				r.Header.Add("Set-Cookie", c.String())
			}
			if location := r.Header.Get("Location"); location != "" {
				u, err := url.Parse(location)
				if err != nil {
					return errors.New("invalid redirect")
				}
				if u.IsAbs() {
					if u.Scheme != target.Scheme || u.Host != target.Host {
						return errors.New("external redirects are blocked")
					}
					u.Scheme = "http"
					u.Host = localHost
					r.Header.Set("Location", u.String())
				} else if strings.HasPrefix(location, "//") {
					return errors.New("external redirects are blocked")
				}
			}
			// A loopback HTTP page cannot use upgrade-insecure-requests.
			csp := r.Header.Get("Content-Security-Policy")
			directives := []string{}
			for _, d := range strings.Split(csp, ";") {
				if strings.TrimSpace(d) != "upgrade-insecure-requests" && strings.TrimSpace(d) != "" {
					directives = append(directives, d)
				}
			}
			rewrittenCSP := strings.Join(directives, ";")
			rewrittenCSP = strings.ReplaceAll(rewrittenCSP, "wss://"+target.Host, "ws://"+localHost)
			rewrittenCSP = strings.ReplaceAll(rewrittenCSP, "https://"+target.Host, localOrigin)
			r.Header.Set("Content-Security-Policy", rewrittenCSP)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "Raspberry non raggiungibile. Verifica connessione e autorizzazioni.", http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != localHost || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Desktop-Capability")), []byte(capability)) != 1 {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != localOrigin {
			http.Error(w, "Forbidden origin", http.StatusForbidden)
			return
		}
		if r.URL.IsAbs() || r.Method == http.MethodConnect {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		p.ServeHTTP(w, r)
	})
}
