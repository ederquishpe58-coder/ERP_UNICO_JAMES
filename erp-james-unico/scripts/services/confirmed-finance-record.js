(function(){
  const erp = window.BlessERP = window.BlessERP || {};
  const pending = new Set();
  function identity() {
    const access = erp.authAccess?.activeAccess?.() || {};
    const selected = erp.services?.companyContext?.activeCompanyId?.() || access.activeCompany?.id || "";
    const company = (access.companies || []).find(row => [row.id, row.company_key].includes(selected))
      || ([access.activeCompany?.id, access.activeCompany?.company_key].includes(selected) ? access.activeCompany : null);
    return { userId: access.session?.user?.id || "", companyId: company?.id || "" };
  }
  function fingerprint(value) {
    if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function save(entity, prepare) {
    const context = identity();
    const registry = erp.syncEntityRegistry;
    if (!["customers", "accounting_journal_entries", "purchases"].includes(entity)
        || !context.userId || !context.companyId || !registry?.serializableRecord || !erp.state?.saveDbConfirmed) {
      return { ok: false, confirmed: false, errors: ["No está disponible la confirmación canónica de Supabase."] };
    }
    const contextKey = `${context.userId}:${context.companyId}:${entity}`;
    if (pending.has(contextKey)) return { ok: false, confirmed: false, errors: ["Ya hay un guardado en curso."] };
    pending.add(contextKey);
    let prepared;
    try {
      prepared = prepare();
      if (!prepared?.ok) return { ...prepared, ok: false, confirmed: false };
      const record = prepared.customer || prepared.entry || prepared.purchase;
      const expected = registry.serializableRecord(record, entity);
      const result = await erp.state.saveDbConfirmed({ entity, recordId: record.id, skipCloudSnapshot: true });
      const current = identity();
      if (current.companyId !== context.companyId || current.userId !== context.userId) {
        return { ...prepared, ok: false, confirmed: false, contextChanged: true, errors: ["La empresa o sesión cambió durante el guardado. Consulte el registro en su empresa de origen."] };
      }
      const server = result?.serverRecord;
      if (result?.ok !== true || result?.confirmed !== true || !server || server.deleted_at
          || server.company_id !== context.companyId || server.entity !== entity || server.record_id !== record.id
          || Number(server.version || 0) < 1
          || fingerprint(registry.serializableRecord(server.payload, entity)) !== fingerprint(expected)) {
        return { ...prepared, ok: false, confirmed: false, errors: [result?.message || "Supabase no confirmó esta versión del registro. No se informó éxito."] };
      }
      return { ...prepared, ok: true, confirmed: true, serverRecord: server };
    } catch (error) {
      return { ...prepared, ok: false, confirmed: false, errors: [error?.message || "No se pudo confirmar la persistencia."] };
    } finally { pending.delete(contextKey); }
  }
  erp.services = erp.services || {};
  erp.services.confirmedFinanceRecord = { save };
})();
