package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"tailscale.com/ipn"
)

// The encryption key arrives over stdin from Electron's OS-backed safeStorage.
// No enrollment key, plaintext state, or encryption key is written to disk.
type encryptedStore struct {
	mu     sync.Mutex
	path   string
	aead   cipher.AEAD
	values map[ipn.StateKey][]byte
}

func newStore(path string, key []byte) (*encryptedStore, error) {
	if len(key) != 32 {
		return nil, errors.New("invalid state encryption key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	s := &encryptedStore{path: path, aead: aead, values: map[ipn.StateKey][]byte{}}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) < aead.NonceSize() {
		return nil, errors.New("invalid encrypted state")
	}
	plain, err := aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], []byte("mediapiayer-state-v1"))
	if err != nil {
		return nil, errors.New("cannot decrypt Tailscale state")
	}
	if err = json.Unmarshal(plain, &s.values); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *encryptedStore) ReadState(id ipn.StateKey) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.values[id]
	if !ok {
		return nil, ipn.ErrStateNotExist
	}
	return append([]byte(nil), v...), nil
}
func (s *encryptedStore) WriteState(id ipn.StateKey, bs []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Commit the in-memory map only after persistence succeeds.
	next := make(map[ipn.StateKey][]byte, len(s.values)+1)
	for k, v := range s.values {
		next[k] = v
	}
	if bs == nil {
		delete(next, id)
	} else {
		next[id] = append([]byte(nil), bs...)
	}
	plain, err := json.Marshal(next)
	if err != nil {
		return err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	data := s.aead.Seal(nonce, nonce, plain, []byte("mediapiayer-state-v1"))
	if err = os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".state-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err = temp.Chmod(0600); err == nil {
		_, err = temp.Write(data)
	}
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, s.path)
	}
	if err != nil {
		return err
	}
	s.values = next
	return nil
}
