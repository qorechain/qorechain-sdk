package query

import (
	"crypto/tls"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	lightnodev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/lightnode/v1"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	qcav1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/qca/v1"
	reputationv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/reputation/v1"
	rlconsensusv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rlconsensus/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

// GRPCClient holds a gRPC connection to a QoreChain node and exposes the typed
// Query service clients for every module that defines a gRPC query service
// (crossvm, lightnode, pqc, qca, reputation, rlconsensus, svm).
//
// The underlying *grpc.ClientConn satisfies the gogoproto grpc.ClientConn
// interface the generated clients require, so each accessor returns the
// generated, fully typed QueryClient for that module.
type GRPCClient struct {
	conn *grpc.ClientConn
}

// NewGRPCClient dials the gRPC endpoint and returns a GRPCClient.
//
// If the endpoint uses an https:// scheme TLS is enabled; otherwise (http:// or
// bare host:port) the connection is insecure, which is the common local-node
// case. Additional dial options may be supplied to override the defaults.
func NewGRPCClient(endpoint string, opts ...grpc.DialOption) (*GRPCClient, error) {
	target, secure := normalizeGRPCTarget(endpoint)
	dialOpts := []grpc.DialOption{}
	if secure {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})))
	} else {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	dialOpts = append(dialOpts, opts...)
	conn, err := grpc.NewClient(target, dialOpts...)
	if err != nil {
		return nil, err
	}
	return &GRPCClient{conn: conn}, nil
}

// NewGRPCClientWithConn wraps an existing *grpc.ClientConn (caller owns its
// lifecycle).
func NewGRPCClientWithConn(conn *grpc.ClientConn) *GRPCClient {
	return &GRPCClient{conn: conn}
}

// Conn returns the underlying gRPC connection.
func (c *GRPCClient) Conn() *grpc.ClientConn { return c.conn }

// Close closes the underlying gRPC connection.
func (c *GRPCClient) Close() error {
	if c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// CrossVM returns the typed crossvm Query client.
func (c *GRPCClient) CrossVM() crossvmv1.QueryClient { return crossvmv1.NewQueryClient(c.conn) }

// Lightnode returns the typed lightnode Query client.
func (c *GRPCClient) Lightnode() lightnodev1.QueryClient { return lightnodev1.NewQueryClient(c.conn) }

// PQC returns the typed pqc Query client.
func (c *GRPCClient) PQC() pqcv1.QueryClient { return pqcv1.NewQueryClient(c.conn) }

// QCA returns the typed qca Query client.
func (c *GRPCClient) QCA() qcav1.QueryClient { return qcav1.NewQueryClient(c.conn) }

// Reputation returns the typed reputation Query client.
func (c *GRPCClient) Reputation() reputationv1.QueryClient {
	return reputationv1.NewQueryClient(c.conn)
}

// RLConsensus returns the typed rlconsensus Query client.
func (c *GRPCClient) RLConsensus() rlconsensusv1.QueryClient {
	return rlconsensusv1.NewQueryClient(c.conn)
}

// SVM returns the typed svm Query client.
func (c *GRPCClient) SVM() svmv1.QueryClient { return svmv1.NewQueryClient(c.conn) }

// normalizeGRPCTarget strips a URL scheme from endpoint and reports whether TLS
// should be used (true for https://).
func normalizeGRPCTarget(endpoint string) (target string, secure bool) {
	switch {
	case strings.HasPrefix(endpoint, "https://"):
		return strings.TrimPrefix(endpoint, "https://"), true
	case strings.HasPrefix(endpoint, "http://"):
		return strings.TrimPrefix(endpoint, "http://"), false
	default:
		return endpoint, false
	}
}
