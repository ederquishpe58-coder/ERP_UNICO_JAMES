// Only allowlisted, bounded diagnostics may cross the transport boundary.
// Never retain the native Error object, request XML, headers or certificates.
const UNCERTAIN = "TRANSPORT_RESULT_UNCERTAIN";
const DEFINITE = "TRANSPORT_FAILED_DEFINITE";

function safeText(value, limit = 600) {
  return String(value ?? "")
    .replace(/-----BEGIN[\s\S]*?(?:-----END[^-]+-----|$)/gi, "[REDACTED_PEM]")
    .replace(/<[^>]*>[\s\S]*/g, "[REDACTED_XML]")
    .replace(/&lt;[\s\S]*/gi, "[REDACTED_XML]")
    .replace(/https?:\/\/[^\s]+/gi, url => {
      try { return new URL(url).origin; } catch { return "[REDACTED_URL]"; }
    })
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/(["']?\b(?:password|passwd|token|secret|authorization|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b\d{10,}\b/g, "[REDACTED_ID]")
    .replace(/[A-Za-z0-9+/=_-]{64,}/g, "[REDACTED_DATA]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
}

function nativeCause(error, depth = 0, seen = new Set()) {
  if (typeof error === "string") return { message: safeText(error) };
  if (!error || typeof error !== "object") return null;
  if (seen.has(error) || depth >= 5 || seen.size >= 12) return { truncated: true };
  seen.add(error);
  const result = {};
  for (const key of ["name", "code", "errno", "syscall", "hostname", "message"]) {
    if (typeof error[key] === "number") result[key] = error[key];
    else if (typeof error[key] === "string") result[key] = safeText(error[key], key === "message" ? 600 : 160);
  }
  if (error.cause) result.cause = nativeCause(error.cause, depth + 1, seen);
  if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 4).map(item => nativeCause(item, depth + 1, seen)).filter(Boolean);
  return result;
}

function nativeDiagnostic(error, { responseStatus = null } = {}) {
  const native = nativeCause(error);
  const codes = [];
  let incompleteOrAggregate = false;
  function collect(node) {
    if (!node) return;
    if (node.truncated || node.errors) incompleteOrAggregate = true;
    if (node.code) codes.push(node.code);
    if (["AbortError", "TimeoutError"].includes(node.name)) codes.push(node.name);
    collect(node.cause);
    (node.errors || []).forEach(collect);
  }
  collect(native);
  const dns = code => ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(code);
  const tls = code => /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/.test(code);
  let classification = "NETWORK_OTHER";
  if (codes.some(dns)) classification = "DNS";
  else if (codes.some(tls)) classification = "TLS";
  else if (codes.some(c => /TIMEOUT|TIMEDOUT|AbortError|TimeoutError/.test(c))) classification = "TIMEOUT";
  else if (codes.some(c => ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(c))) classification = "CONNECTION_RESET";
  // A mixed AggregateError is never evidence that no request reached SRI.
  const provenPreconnect = !incompleteOrAggregate && codes.length > 0 && codes.every(c => dns(c) || tls(c) || c === "ECONNREFUSED");
  const resultState = !responseStatus && provenPreconnect ? DEFINITE : UNCERTAIN;
  return { classification: responseStatus ? "HTTP" : classification, nativeClassification: classification, resultState, nextAction: resultState === UNCERTAIN ? "AUTHORIZATION_LOOKUP_FIRST" : "RETRY_TRANSMISSION", httpStatus: responseStatus, native };
}

module.exports = { UNCERTAIN, DEFINITE, safeText, nativeCause, nativeDiagnostic };
