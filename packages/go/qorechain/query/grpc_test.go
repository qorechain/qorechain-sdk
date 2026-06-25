package query

import (
	"context"
	"net"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
)

// fakeCrossVMServer is an in-memory crossvm Query service used to prove the
// generated typed gRPC client round-trips request/response over a real gRPC
// transport (bufconn) without any network.
type fakeCrossVMServer struct {
	crossvmv1.UnimplementedQueryServer
}

func (*fakeCrossVMServer) Params(context.Context, *crossvmv1.QueryParamsRequest) (*crossvmv1.QueryParamsResponse, error) {
	return &crossvmv1.QueryParamsResponse{MaxMessageSize: 4096, MaxQueueSize: 100, QueueTimeoutBlocks: 50, Enabled: true}, nil
}

func (*fakeCrossVMServer) Message(_ context.Context, req *crossvmv1.QueryMessageRequest) (*crossvmv1.QueryMessageResponse, error) {
	return &crossvmv1.QueryMessageResponse{
		Found:   true,
		Message: &crossvmv1.CrossVMMessageView{Id: req.Id, Status: "executed", SourceVm: "evm", TargetVm: "svm"},
	}, nil
}

func TestGRPCClientTypedQuery(t *testing.T) {
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	crossvmv1.RegisterQueryServer(srv, &fakeCrossVMServer{})
	go func() { _ = srv.Serve(lis) }()
	defer srv.Stop()

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn: %v", err)
	}
	defer conn.Close()

	c := NewGRPCClientWithConn(conn)

	params, err := c.CrossVM().Params(context.Background(), &crossvmv1.QueryParamsRequest{})
	if err != nil {
		t.Fatalf("Params: %v", err)
	}
	if params.MaxMessageSize != 4096 || !params.Enabled {
		t.Fatalf("unexpected params: %+v", params)
	}

	msg, err := c.CrossVM().Message(context.Background(), &crossvmv1.QueryMessageRequest{Id: "msg-1"})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	if !msg.Found || msg.Message.Id != "msg-1" || msg.Message.Status != "executed" {
		t.Fatalf("unexpected message response: %+v", msg)
	}
}

func TestNormalizeGRPCTarget(t *testing.T) {
	cases := []struct {
		in     string
		target string
		secure bool
	}{
		{"https://grpc.example.com:443", "grpc.example.com:443", true},
		{"http://localhost:9090", "localhost:9090", false},
		{"localhost:9090", "localhost:9090", false},
	}
	for _, tc := range cases {
		target, secure := normalizeGRPCTarget(tc.in)
		if target != tc.target || secure != tc.secure {
			t.Errorf("normalizeGRPCTarget(%q) = (%q,%v), want (%q,%v)", tc.in, target, secure, tc.target, tc.secure)
		}
	}
}
