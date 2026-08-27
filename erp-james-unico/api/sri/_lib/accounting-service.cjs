const { dbError } = require("./document-service.cjs");

async function generateAccountingForDocument(client, documentId, actorUserId) {
  const { data: link, error: linkError } = await client.from("accounting_document_links").select("*")
    .eq("document_id", documentId).in("status", ["PENDING", "FAILED", "GENERATED", "POSTED"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (linkError) throw linkError;
  if (!link) return { generated: false, reason: "NO_ACCOUNTING_LINK" };
  if (link.status === "POSTED" && link.journal_entry_id) return { generated: true, idempotent: true, journalEntryId: link.journal_entry_id };
  try {
    const entry = dbError(await client.rpc("generate_sri_accounting_entry", {
      p_document_id: documentId,
      p_actor_user_id: actorUserId
    }), "Generacion contable SRI");
    return { generated: true, idempotent: false, entry };
  } catch (error) {
    await client.from("accounting_document_links").update({
      status: "FAILED",
      error_message: error.message,
      updated_at: new Date().toISOString()
    }).eq("id", link.id).in("status", ["PENDING", "FAILED"]);
    await client.from("electronic_document_audit_logs").insert({
      company_id: link.company_id,
      document_id: documentId,
      actor_user_id: actorUserId,
      actor_type: "SYSTEM",
      action: "ACCOUNTING_ENTRY_FAILED",
      reason: error.message
    });
    return { generated: false, reason: "ACCOUNTING_RULE_OR_POSTING_ERROR", error: error.message };
  }
}

module.exports = { generateAccountingForDocument };
