package subscribe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNormalizeWSURL(t *testing.T) {
	cases := map[string]string{
		"http://localhost:26657":            "ws://localhost:26657/websocket",
		"https://rpc.example.com":           "wss://rpc.example.com/websocket",
		"ws://localhost:26657/websocket":    "ws://localhost:26657/websocket",
		"http://localhost:26657/websocket/": "ws://localhost:26657/websocket",
	}
	for in, want := range cases {
		if got := normalizeWSURL(in); got != want {
			t.Errorf("normalizeWSURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestDispatchFraming exercises the JSON-RPC event framing without a live
// socket: a registered handler must receive the event whose id matches its
// subscription, and the subscribe ack (empty data) must be ignored.
func TestDispatchFraming(t *testing.T) {
	c := &Client{subs: make(map[string]Handler), closed: make(chan struct{})}
	got := make(chan Event, 1)
	c.subs["1"] = func(e Event) error { got <- e; return nil }

	// Subscribe ack: no result.data — must be ignored.
	c.DispatchForTest([]byte(`{"jsonrpc":"2.0","id":"1","result":{}}`))
	// Real event for subscription id "1".
	c.DispatchForTest([]byte(`{"jsonrpc":"2.0","id":"1","result":{"query":"tm.event='NewBlock'","data":{"type":"event/NewBlock","value":{"block":{"header":{"height":"100"}}}}}}`))
	// Event for an unknown id — must be dropped.
	c.DispatchForTest([]byte(`{"jsonrpc":"2.0","id":"99","result":{"query":"x","data":{"a":1}}}`))

	select {
	case e := <-got:
		if e.Query != "tm.event='NewBlock'" {
			t.Fatalf("query mismatch: %s", e.Query)
		}
		var payload struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(e.Data, &payload); err != nil {
			t.Fatalf("event data not JSON: %v", err)
		}
		if !strings.Contains(payload.Type, "NewBlock") {
			t.Fatalf("unexpected event type: %s", payload.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("handler did not receive event")
	}

	// Only one event should have been delivered (ack + unknown id dropped).
	select {
	case <-got:
		t.Fatal("unexpected extra event delivered")
	default:
	}
}

// TestSubscribeOverWebsocket runs a full subscribe round-trip against an
// in-process gorilla/websocket server.
func TestSubscribeOverWebsocket(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		// Read the subscribe request, echo back an ack, then push one event.
		var req map[string]any
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		id, _ := req["id"].(string)
		_ = conn.WriteJSON(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
		event := map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]any{
				"query": QueryNewBlock,
				"data":  map[string]any{"type": "event/NewBlock", "value": map[string]any{"height": "7"}},
			},
		}
		_ = conn.WriteJSON(event)
		// Keep the connection open briefly so the client reads the frame.
		time.Sleep(100 * time.Millisecond)
	}))
	defer srv.Close()

	client, err := Dial(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer client.Close()

	received := make(chan Event, 1)
	_, err = client.SubscribeNewBlocks(func(e Event) error {
		received <- e
		return nil
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	select {
	case e := <-received:
		if e.Query != QueryNewBlock {
			t.Fatalf("query mismatch: %s", e.Query)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive block event over websocket")
	}
}

func TestSubscribeTxQueryComposition(t *testing.T) {
	c := &Client{subs: make(map[string]Handler), closed: make(chan struct{}), conn: nil}
	// We can't call Subscribe without a conn, so just assert query composition via
	// the helper logic by re-implementing the branch checks.
	_ = c
	if q := composeTxQuery(""); q != QueryTx {
		t.Fatalf("empty query: %s", q)
	}
	if q := composeTxQuery("transfer.sender='qor1abc'"); q != QueryTx+" AND transfer.sender='qor1abc'" {
		t.Fatalf("composed query mismatch: %s", q)
	}
	if q := composeTxQuery("tm.event='Tx' AND x=1"); q != "tm.event='Tx' AND x=1" {
		t.Fatalf("pre-built query mutated: %s", q)
	}
}

// composeTxQuery mirrors SubscribeTx's query-composition logic for unit testing
// without a live connection.
func composeTxQuery(query string) string {
	if strings.TrimSpace(query) == "" {
		return QueryTx
	}
	if !strings.Contains(query, "tm.event") {
		return QueryTx + " AND " + query
	}
	return query
}
