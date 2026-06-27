package query

import (
	"context"
	"net"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	bridgev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/bridge/v1"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	multilayerv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/multilayer/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
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

// dialBufconn wires a bufconn listener to a fresh grpc.Server (which register
// has already attached its service to) and returns a GRPCClient over it. The
// returned cleanup stops the server and closes the connection.
func dialBufconn(t *testing.T, register func(*grpc.Server)) (*GRPCClient, func()) {
	t.Helper()
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	register(srv)
	go func() { _ = srv.Serve(lis) }()

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		srv.Stop()
		t.Fatalf("dial bufconn: %v", err)
	}
	return NewGRPCClientWithConn(conn), func() {
		_ = conn.Close()
		srv.Stop()
	}
}

// fakeMultilayerServer is an in-memory multilayer Query service.
type fakeMultilayerServer struct {
	multilayerv1.UnimplementedQueryServer
}

func (*fakeMultilayerServer) Params(context.Context, *multilayerv1.QueryParamsRequest) (*multilayerv1.QueryParamsResponse, error) {
	return &multilayerv1.QueryParamsResponse{Params: &multilayerv1.ParamsView{MaxSidechains: 10, RoutingEnabled: true}}, nil
}

func (*fakeMultilayerServer) Layer(_ context.Context, req *multilayerv1.QueryLayerRequest) (*multilayerv1.QueryLayerResponse, error) {
	return &multilayerv1.QueryLayerResponse{Layer: &multilayerv1.LayerView{LayerId: req.LayerId, LayerType: "sidechain", Status: "active"}}, nil
}

func (*fakeMultilayerServer) Layers(context.Context, *multilayerv1.QueryLayersRequest) (*multilayerv1.QueryLayersResponse, error) {
	return &multilayerv1.QueryLayersResponse{Layers: []*multilayerv1.LayerView{{LayerId: "l1"}, {LayerId: "l2"}}}, nil
}

func (*fakeMultilayerServer) RoutingStats(context.Context, *multilayerv1.QueryRoutingStatsRequest) (*multilayerv1.QueryRoutingStatsView, error) {
	return &multilayerv1.QueryRoutingStatsView{Stats: &multilayerv1.RoutingStatsView{TotalRouted: 42, RoutedToSidechains: 30}}, nil
}

func TestGRPCMultilayerQuery(t *testing.T) {
	c, cleanup := dialBufconn(t, func(s *grpc.Server) {
		multilayerv1.RegisterQueryServer(s, &fakeMultilayerServer{})
	})
	defer cleanup()
	ctx := context.Background()

	params, err := c.Multilayer().Params(ctx, &multilayerv1.QueryParamsRequest{})
	if err != nil {
		t.Fatalf("Params: %v", err)
	}
	if params.Params.MaxSidechains != 10 || !params.Params.RoutingEnabled {
		t.Fatalf("unexpected params: %+v", params.Params)
	}

	layer, err := c.Multilayer().Layer(ctx, &multilayerv1.QueryLayerRequest{LayerId: "layer-1"})
	if err != nil {
		t.Fatalf("Layer: %v", err)
	}
	if layer.Layer.LayerId != "layer-1" || layer.Layer.Status != "active" {
		t.Fatalf("unexpected layer: %+v", layer.Layer)
	}

	layers, err := c.Multilayer().Layers(ctx, &multilayerv1.QueryLayersRequest{})
	if err != nil {
		t.Fatalf("Layers: %v", err)
	}
	if len(layers.Layers) != 2 {
		t.Fatalf("unexpected layers: %+v", layers.Layers)
	}

	stats, err := c.Multilayer().RoutingStats(ctx, &multilayerv1.QueryRoutingStatsRequest{})
	if err != nil {
		t.Fatalf("RoutingStats: %v", err)
	}
	if stats.Stats.TotalRouted != 42 {
		t.Fatalf("unexpected stats: %+v", stats.Stats)
	}
}

// fakeRdkServer is an in-memory rdk Query service.
type fakeRdkServer struct {
	rdkv1.UnimplementedQueryServer
}

func (*fakeRdkServer) Params(context.Context, *rdkv1.QueryParamsRequest) (*rdkv1.QueryParamsResponse, error) {
	return &rdkv1.QueryParamsResponse{Params: &rdkv1.ParamsView{MaxRollups: 5}}, nil
}

func (*fakeRdkServer) Rollup(_ context.Context, req *rdkv1.QueryRollupRequest) (*rdkv1.QueryRollupResponse, error) {
	return &rdkv1.QueryRollupResponse{Rollup: &rdkv1.RollupView{RollupId: req.RollupId, Status: "active"}}, nil
}

func (*fakeRdkServer) Rollups(context.Context, *rdkv1.QueryRollupsRequest) (*rdkv1.QueryRollupsResponse, error) {
	return &rdkv1.QueryRollupsResponse{Rollups: []*rdkv1.RollupView{{RollupId: "r1"}}}, nil
}

func (*fakeRdkServer) Batch(_ context.Context, req *rdkv1.QueryBatchRequest) (*rdkv1.QueryBatchResponse, error) {
	return &rdkv1.QueryBatchResponse{Batch: &rdkv1.BatchView{RollupId: req.RollupId, BatchIndex: req.BatchIndex, Status: "finalized", WithdrawalsRoot: "0xroot"}}, nil
}

func (*fakeRdkServer) LatestBatch(_ context.Context, req *rdkv1.QueryLatestBatchRequest) (*rdkv1.QueryLatestBatchResponse, error) {
	return &rdkv1.QueryLatestBatchResponse{Batch: &rdkv1.BatchView{RollupId: req.RollupId, BatchIndex: 9}}, nil
}

func TestGRPCRdkQuery(t *testing.T) {
	c, cleanup := dialBufconn(t, func(s *grpc.Server) {
		rdkv1.RegisterQueryServer(s, &fakeRdkServer{})
	})
	defer cleanup()
	ctx := context.Background()

	params, err := c.Rdk().Params(ctx, &rdkv1.QueryParamsRequest{})
	if err != nil {
		t.Fatalf("Params: %v", err)
	}
	if params.Params.MaxRollups != 5 {
		t.Fatalf("unexpected params: %+v", params.Params)
	}

	rollup, err := c.Rdk().Rollup(ctx, &rdkv1.QueryRollupRequest{RollupId: "rollup-1"})
	if err != nil {
		t.Fatalf("Rollup: %v", err)
	}
	if rollup.Rollup.RollupId != "rollup-1" || rollup.Rollup.Status != "active" {
		t.Fatalf("unexpected rollup: %+v", rollup.Rollup)
	}

	rollups, err := c.Rdk().Rollups(ctx, &rdkv1.QueryRollupsRequest{})
	if err != nil {
		t.Fatalf("Rollups: %v", err)
	}
	if len(rollups.Rollups) != 1 {
		t.Fatalf("unexpected rollups: %+v", rollups.Rollups)
	}

	batch, err := c.Rdk().Batch(ctx, &rdkv1.QueryBatchRequest{RollupId: "rollup-1", BatchIndex: 3})
	if err != nil {
		t.Fatalf("Batch: %v", err)
	}
	if batch.Batch.BatchIndex != 3 || batch.Batch.WithdrawalsRoot != "0xroot" {
		t.Fatalf("unexpected batch: %+v", batch.Batch)
	}

	latest, err := c.Rdk().LatestBatch(ctx, &rdkv1.QueryLatestBatchRequest{RollupId: "rollup-1"})
	if err != nil {
		t.Fatalf("LatestBatch: %v", err)
	}
	if latest.Batch.BatchIndex != 9 {
		t.Fatalf("unexpected latest batch: %+v", latest.Batch)
	}
}

// fakeBridgeServer is an in-memory bridge Query service.
type fakeBridgeServer struct {
	bridgev1.UnimplementedQueryServer
}

func (*fakeBridgeServer) Config(context.Context, *bridgev1.QueryConfigRequest) (*bridgev1.QueryConfigResponse, error) {
	return &bridgev1.QueryConfigResponse{Config: &bridgev1.BridgeConfigView{MinValidators: 3, Enabled: true}}, nil
}

func (*fakeBridgeServer) ChainConfig(_ context.Context, req *bridgev1.QueryChainConfigRequest) (*bridgev1.QueryChainConfigResponse, error) {
	return &bridgev1.QueryChainConfigResponse{Chain: &bridgev1.ChainConfigView{ChainId: req.ChainId, Status: "active"}}, nil
}

func (*fakeBridgeServer) ChainConfigs(context.Context, *bridgev1.QueryChainConfigsRequest) (*bridgev1.QueryChainConfigsResponse, error) {
	return &bridgev1.QueryChainConfigsResponse{Chains: []*bridgev1.ChainConfigView{{ChainId: "eth"}}}, nil
}

func TestGRPCBridgeQuery(t *testing.T) {
	c, cleanup := dialBufconn(t, func(s *grpc.Server) {
		bridgev1.RegisterQueryServer(s, &fakeBridgeServer{})
	})
	defer cleanup()
	ctx := context.Background()

	cfg, err := c.Bridge().Config(ctx, &bridgev1.QueryConfigRequest{})
	if err != nil {
		t.Fatalf("Config: %v", err)
	}
	if cfg.Config.MinValidators != 3 || !cfg.Config.Enabled {
		t.Fatalf("unexpected config: %+v", cfg.Config)
	}

	chain, err := c.Bridge().ChainConfig(ctx, &bridgev1.QueryChainConfigRequest{ChainId: "eth"})
	if err != nil {
		t.Fatalf("ChainConfig: %v", err)
	}
	if chain.Chain.ChainId != "eth" || chain.Chain.Status != "active" {
		t.Fatalf("unexpected chain: %+v", chain.Chain)
	}

	chains, err := c.Bridge().ChainConfigs(ctx, &bridgev1.QueryChainConfigsRequest{})
	if err != nil {
		t.Fatalf("ChainConfigs: %v", err)
	}
	if len(chains.Chains) != 1 {
		t.Fatalf("unexpected chains: %+v", chains.Chains)
	}
}
