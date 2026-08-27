const { SriConfigurationError } = require("./sri/_lib/errors.cjs");
const { getSupabaseAdmin } = require("./sri/_lib/supabase-admin.cjs");
const { transmitDocument } = require("./sri/_lib/transmission-service.cjs");

function authorized(request) {
  const configured = String(process.env.CRON_SECRET || process.env.SRI_RETRY_CRON_SECRET || "");
  if (!configured) throw new SriConfigurationError("No se configuro el secreto del trabajador SRI.");
  const supplied = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return supplied.length === configured.length && supplied === configured;
}

function send(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

module.exports = async function retryHandler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    return send(response, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  try {
    if (!authorized(request)) return send(response, 401, { ok: false, error: "UNAUTHORIZED" });
    const client = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data: jobs, error } = await client.from("sri_transmissions")
      .select("id, company_id, document_id, status, attempt_number, max_attempts, next_attempt_at")
      .in("status", ["PENDING", "RETRY_SCHEDULED"])
      .lte("next_attempt_at", now)
      .order("next_attempt_at", { ascending: true })
      .limit(25);
    if (error) throw error;

    const due = (jobs || []).filter(job => job.attempt_number < job.max_attempts);
    const results = [];
    for (const job of due) {
      try {
        const detail = await transmitDocument(client, job.company_id, job.document_id, null, { force: false });
        results.push({ jobId: job.id, documentId: job.document_id, status: detail.document.status, processed: true });
      } catch (error) {
        results.push({
          jobId: job.id,
          documentId: job.document_id,
          processed: false,
          retryable: Boolean(error.retryable),
          errorCode: error.code || "WORKER_ERROR"
        });
      }
    }
    return send(response, 200, {
      ok: true,
      checkedAt: now,
      dueJobs: due.length,
      processed: results.filter(item => item.processed).length,
      results
    });
  } catch (error) {
    return send(response, error.httpStatus || 500, {
      ok: false,
      error: error.code || "INTERNAL_ERROR",
      message: error.httpStatus ? error.message : "Fallo interno del trabajador SRI."
    });
  }
};
