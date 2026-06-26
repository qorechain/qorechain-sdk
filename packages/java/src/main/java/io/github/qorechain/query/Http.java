package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal HTTP transport built on {@link java.net.http.HttpClient}: GET (with a
 * query map) and POST-JSON, with URL joining/building and bounded retries on
 * 5xx and transport errors. JSON is parsed with Jackson.
 */
public final class Http {

    private Http() {}

    /** Thrown for non-2xx HTTP responses. */
    public static final class QoreHttpException extends RuntimeException {
        public final int status;
        public final String url;
        public final String body;

        public QoreHttpException(int status, String url, String body) {
            super("HTTP " + status + " for " + url);
            this.status = status;
            this.url = url;
            this.body = body;
        }
    }

    /** Transport options: timeout and retry policy. */
    public static final class Options {
        public long timeoutMs = 30000;
        public int retries = 2;
        public long retryDelayMs = 250;
    }

    static final ObjectMapper MAPPER = new ObjectMapper();

    private static HttpClient client(Options opts) {
        HttpClient.Builder b = HttpClient.newBuilder();
        if (opts.timeoutMs > 0) {
            b.connectTimeout(Duration.ofMillis(opts.timeoutMs));
        }
        return b.build();
    }

    /** Strip trailing slashes from base, leading slashes from path, join with one slash. */
    public static String joinUrl(String base, String path) {
        String b = base.replaceAll("/+$", "");
        String p = path.replaceAll("^/+", "");
        return b + "/" + p;
    }

    /** Append a query map to a URL, URL-encoding keys/values and skipping nulls. */
    public static String buildUrl(String base, Map<String, String> query) {
        if (query == null || query.isEmpty()) {
            return base;
        }
        StringBuilder sb = new StringBuilder(base);
        boolean first = !base.contains("?");
        for (Map.Entry<String, String> e : query.entrySet()) {
            if (e.getValue() == null) {
                continue;
            }
            sb.append(first ? '?' : '&');
            first = false;
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8));
            sb.append('=');
            sb.append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    /** GET {@code url} (+ query) and parse the JSON response. */
    public static JsonNode getJson(String url, Map<String, String> query, Options opts) {
        String full = buildUrl(url, query);
        HttpRequest req =
                requestBuilder(full, opts).header("accept", "application/json").GET().build();
        return send(req, full, opts);
    }

    /** POST a JSON body to {@code url} and parse the JSON response. */
    public static JsonNode postJson(String url, Object body, Options opts) {
        String json;
        try {
            json = MAPPER.writeValueAsString(body);
        } catch (IOException e) {
            throw new IllegalStateException("failed to serialize request body", e);
        }
        HttpRequest req =
                requestBuilder(url, opts)
                        .header("content-type", "application/json")
                        .header("accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                        .build();
        return send(req, url, opts);
    }

    private static HttpRequest.Builder requestBuilder(String url, Options opts) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url));
        if (opts.timeoutMs > 0) {
            b.timeout(Duration.ofMillis(opts.timeoutMs));
        }
        return b;
    }

    private static JsonNode send(HttpRequest req, String url, Options opts) {
        RuntimeException last = null;
        for (int attempt = 0; attempt <= opts.retries; attempt++) {
            try {
                HttpResponse<String> res =
                        client(opts).send(req, HttpResponse.BodyHandlers.ofString());
                int status = res.statusCode();
                if (status >= 200 && status < 300) {
                    String b = res.body();
                    return (b == null || b.isEmpty())
                            ? MAPPER.nullNode()
                            : MAPPER.readTree(b);
                }
                if (status >= 500 && status < 600) {
                    last = new QoreHttpException(status, url, res.body());
                } else {
                    // 4xx: do not retry.
                    throw new QoreHttpException(status, url, res.body());
                }
            } catch (QoreHttpException e) {
                throw e;
            } catch (IOException | InterruptedException e) {
                if (e instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                last = new RuntimeException("transport error for " + url + ": " + e.getMessage(), e);
            }
            if (attempt < opts.retries) {
                sleep(opts.retryDelayMs);
            }
        }
        throw last != null ? last : new RuntimeException("request failed for " + url);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** A small ordered string→string map builder for query parameters. */
    public static Map<String, String> query() {
        return new LinkedHashMap<>();
    }
}
