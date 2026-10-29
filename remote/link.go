package main

import (
	"io"
	"log"
	"sync"
	"time"
)

// The reliable half of the protocol: what lets an agent keep running through a dropped connection.
//
// Every frame that carries state (process output, results, requests) is SEQUENCED: it gets the
// next number in its direction and is kept in `unacked` until the peer acknowledges it. A
// connection that drops loses nothing — the frames are still here, and the next connection's
// handshake says how far the peer got (`hello.recv`), so exactly the missing tail is resent and
// the peer drops anything it has already seen by its number. Heartbeats and acknowledgements are
// CONTROL frames: unnumbered, never stored, meaningless on any connection but the one they rode.
//
// This side is the daemon's. The gateway keeps the mirror image of the same state
// (src/remote/link.ts), so a message the gateway sent into a dead connection — a user's prompt
// typed during the outage — is resent the same way.

const (
	// unackedCap bounds what the daemon will hold for a gateway that is not reading: process
	// output beyond it waits (sendData blocks), which in turn leaves the agent blocked on a full
	// pipe. Waiting is the point — nothing is ever dropped to make room. 64 MiB is hundreds of
	// turns at the measured tens-to-hundreds of KB a turn (2026-10-29, 1864 turns from this host).
	unackedCap = 64 << 20
	// An acknowledgement goes out after this many received bytes, or ackDelay after the first
	// unacknowledged frame, whichever comes first — and rides free on any frame sent meanwhile.
	ackEveryBytes = 64 << 10
	ackDelay      = 100 * time.Millisecond
)

type sentFrame struct {
	seq uint64
	buf []byte
}

type link struct {
	mu    sync.Mutex
	space *sync.Cond

	epoch        string
	gen          uint64 // bumped by reset; work begun under an older gen must not reach the new peer
	sendSeq      uint64
	unacked      []sentFrame
	unackedBytes int
	recvSeq      uint64

	pendingAck int // bytes received since the last ack we sent
	ackTimer   *time.Timer

	out *connWriter // the live connection's writer; nil while disconnected
}

func newLink() *link {
	l := &link{}
	l.space = sync.NewCond(&l.mu)
	return l
}

// reset forgets everything: a new gateway (different epoch) has nothing to resume.
func (l *link) reset(epoch string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.epoch = epoch
	l.gen++
	l.sendSeq = 0
	l.unacked = nil
	l.unackedBytes = 0
	l.recvSeq = 0
	l.pendingAck = 0
	l.space.Broadcast()
}

// attach makes `w` the live connection: the welcome goes first, then every frame the peer has not
// seen (seq > peerRecv), in order.
func (l *link) attach(w *connWriter, peerRecv uint64, welcome *Header) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.dropAckedLocked(peerRecv)
	welcome.Recv = l.recvSeq
	buf, err := encodeFrame(welcome, nil)
	if err != nil {
		return err
	}
	if l.out != nil {
		l.out.close()
	}
	l.out = w
	w.push(buf)
	for _, f := range l.unacked {
		w.push(f.buf)
	}
	l.pendingAck = 0
	return nil
}

// detach drops `w` if it is still the live connection (a newer one may already have replaced it).
func (l *link) detach(w *connWriter) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.out == w {
		l.out = nil
	}
	w.close()
}

func (l *link) connected() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.out != nil
}

func (l *link) currentGen() uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.gen
}

// send numbers, stores and (when connected) transmits one frame, and reports whether it did. It
// does not when `gen` is no longer current: the frame belongs to a process or request of a gateway
// that has since been replaced, and the new one never asked for it.
//
// With `throttle`, it first waits for the unacknowledged backlog to fall under unackedCap — only
// process output passes it, from goroutines that are allowed to block; the connection reader never
// does, since it is the one that processes the acknowledgements that free the space.
func (l *link) send(gen uint64, h *Header, body []byte, throttle bool) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for throttle && l.unackedBytes >= unackedCap && l.gen == gen {
		l.space.Wait()
	}
	if l.gen != gen {
		return false
	}
	l.sendSeq++
	h.S = l.sendSeq
	h.A = l.recvSeq
	buf, err := encodeFrame(h, body)
	if err != nil {
		log.Printf("dropping unencodable %s frame: %v", h.T, err)
		l.sendSeq--
		return false
	}
	l.unacked = append(l.unacked, sentFrame{seq: h.S, buf: buf})
	l.unackedBytes += len(buf)
	if l.out != nil {
		l.out.push(buf)
		l.pendingAck = 0
	}
	return true
}

// control transmits an unnumbered frame on the live connection, if there is one.
func (l *link) control(h *Header) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.out == nil {
		return
	}
	h.A = l.recvSeq
	buf, err := encodeFrame(h, nil)
	if err != nil {
		return
	}
	l.out.push(buf)
	if h.A > 0 {
		l.pendingAck = 0
	}
}

func (l *link) onAck(a uint64) {
	if a == 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.dropAckedLocked(a)
}

func (l *link) dropAckedLocked(a uint64) {
	i := 0
	for i < len(l.unacked) && l.unacked[i].seq <= a {
		l.unackedBytes -= len(l.unacked[i].buf)
		i++
	}
	if i > 0 {
		l.unacked = append([]sentFrame(nil), l.unacked[i:]...)
		l.space.Broadcast()
	}
}

// accept checks a sequenced frame's number: true to deliver it, false for a duplicate (already
// delivered before a reconnect). A gap cannot happen on an ordered stream that resumed where the
// peer said it was, so it is reported as an error and the connection is dropped.
func (l *link) accept(h *Header, size int) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if h.S <= l.recvSeq {
		return false, nil
	}
	if h.S != l.recvSeq+1 {
		return false, errSeqGap{want: l.recvSeq + 1, got: h.S}
	}
	l.recvSeq = h.S
	l.pendingAck += size + 1
	if l.pendingAck >= ackEveryBytes {
		l.flushAckLocked()
	} else if l.ackTimer == nil {
		l.ackTimer = time.AfterFunc(ackDelay, func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			l.ackTimer = nil
			if l.pendingAck > 0 {
				l.flushAckLocked()
			}
		})
	}
	return true, nil
}

func (l *link) flushAckLocked() {
	if l.out == nil {
		return
	}
	buf, err := encodeFrame(&Header{T: "ack", A: l.recvSeq}, nil)
	if err != nil {
		return
	}
	l.out.push(buf)
	l.pendingAck = 0
}

type errSeqGap struct{ want, got uint64 }

func (e errSeqGap) Error() string {
	return "sequence gap: expected " + itoa(e.want) + ", got " + itoa(e.got)
}

// connWriter serializes frames onto one connection from any goroutine without ever blocking the
// caller on the network: frames queue here and one goroutine writes them out. The queue is not
// bounded on its own — everything in it is either a sequenced frame already counted against
// unackedCap or a small control frame.
type connWriter struct {
	mu     sync.Mutex
	cond   *sync.Cond
	q      [][]byte
	closed bool
	w      io.Writer
	onErr  func(error)
	// drainClose: stop once the queue is empty (closeAfterDrain — a shim's exit code must reach
	// the shim before its connection is closed).
	drainClose bool
	done       chan struct{}
}

func newConnWriter(w io.Writer, onErr func(error)) *connWriter {
	cw := &connWriter{w: w, onErr: onErr, done: make(chan struct{})}
	cw.cond = sync.NewCond(&cw.mu)
	go cw.loop()
	return cw
}

func (cw *connWriter) push(buf []byte) {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	if cw.closed {
		return
	}
	cw.q = append(cw.q, buf)
	cw.cond.Signal()
}

// close stops the writer; anything still queued is discarded.
func (cw *connWriter) close() {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	cw.closed = true
	cw.q = nil
	cw.cond.Signal()
}

// closeAfterDrain stops accepting frames but writes what is queued first.
func (cw *connWriter) closeAfterDrain() {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	cw.drainClose = true
	cw.cond.Signal()
}

func (cw *connWriter) loop() {
	defer close(cw.done)
	for {
		cw.mu.Lock()
		for len(cw.q) == 0 && !cw.closed && !cw.drainClose {
			cw.cond.Wait()
		}
		if cw.closed || (cw.drainClose && len(cw.q) == 0) {
			cw.mu.Unlock()
			return
		}
		batch := cw.q
		cw.q = nil
		cw.mu.Unlock()
		for _, b := range batch {
			if _, err := cw.w.Write(b); err != nil {
				cw.mu.Lock()
				cw.closed = true
				cw.q = nil
				cw.mu.Unlock()
				if cw.onErr != nil {
					cw.onErr(err)
				}
				return
			}
		}
	}
}

func itoa(v uint64) string {
	if v == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	return string(b[i:])
}
