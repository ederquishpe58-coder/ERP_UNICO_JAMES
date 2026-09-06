(function(){
  const erp = window.BlessERP = window.BlessERP || {};
  const allowed = new Set(['company_settings', 'accounting_chart_accounts', 'accounting_journal_entries',
    'accounting_document_sequences', 'accounting_cost_centers', 'accounting_tax_parameters',
    'accounting_retention_parameters', 'material_inventory_movements', 'collections', 'payments', 'commercial_preorders']);
  const insertOnly = new Set(['material_inventory_movements', 'collections', 'payments']);
  const pending = new Map(), busy = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  async function requestWithDeadline(request) {
    let timer;
    try {
      return await Promise.race([request, new Promise((_, reject) => {
        timer = setTimeout(() => reject({ code: 'CANONICAL_ACK_TIMEOUT' }), 30000);
      })]);
    } finally { clearTimeout(timer); }
  }
  function intentValue(value) {
    if (Array.isArray(value)) return value.map(intentValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['updatedAt', 'createdAt', 'cancelledAt', 'confirmedAt', 'reopenedAt', 'annulledAt'].includes(key)).map(([key, item]) => [key, intentValue(item)]));
  }
  function fingerprint(value) {
    if (Array.isArray(value)) return '[' + value.map(fingerprint).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + fingerprint(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function identity() {
    const access = erp.authAccess?.activeAccess?.() || {};
    const selected = erp.services?.companyContext?.activeCompanyId?.() || access.activeCompany?.id;
    const company = (access.companies || []).find(row => [row.id, row.company_key].includes(selected))
      || ([access.activeCompany?.id, access.activeCompany?.company_key].includes(selected) ? access.activeCompany : null);
    return { userId: access.session?.user?.id || '', companyId: company?.id || '' };
  }
  function fail(message, code = 'CANONICAL_CONFIRMATION_REQUIRED') {
    return { ok: false, confirmed: false, code, message, errors: [message] };
  }
  function unavailable(operation) {
    return fail(`${operation}: no existe una transacción canónica habilitada. No se guardó ni confirmó el cambio.`, 'CANONICAL_WRITE_UNAVAILABLE');
  }
  async function commit(entity, record, options = {}) {
    const ctx = identity(), registry = erp.syncEntityRegistry, client = erp.getSupabaseClient?.();
    if (!allowed.has(entity) || !ctx.companyId || !ctx.userId || !client || !registry?.serializableRecord
        || !erp.offlineSync?.applyRemoteRecord) return fail('Se requiere sesión ERP, empresa y persistencia canónica disponible.');
    let payload = clone(registry.serializableRecord(record, entity));
    const id = entity === 'company_settings' ? entity : String(payload.id || '');
    if (!id) return fail('Falta la identidad estable del borrador.');
    if (entity === 'accounting_document_sequences' && payload.documentType) return fail('Use la configuración SRI canónica. Esta acción no modifica secuencias SRI.', 'SRI_CANONICAL_PATH_REQUIRED');
    if (entity === 'accounting_journal_entries' && !['BORRADOR', 'DRAFT', 'ANULADO', 'CANCELLED'].includes(payload.status)) return fail('La contabilización requiere Finance V2.', 'FINANCE_V2_REQUIRED');
    const key = [ctx.userId, ctx.companyId, entity, id].join(':');
    if (busy.has(key)) return fail('Ya hay un guardado en curso. Espere su resultado.', 'WRITE_IN_PROGRESS');
    busy.add(key);
    try {
      let request = pending.get(key);
      const intent = fingerprint({ payload: intentValue(payload), remove: options.remove === true });
      if (request && request.intent !== intent) return fail('Existe un intento sin confirmar. Reintente el mismo cambio o consulte el registro antes de editarlo.', 'UNCONFIRMED_OPERATION_PENDING');
      if (!request) {
        const { data: current, error } = await requestWithDeadline(client.from('erp_entity_records').select('*')
          .eq('company_id', ctx.companyId).eq('entity', entity).eq('record_id', id).maybeSingle());
        if (error) throw error;
        if (fingerprint(identity()) !== fingerprint(ctx)) return fail('La empresa o sesión cambió. Vuelva a abrir el formulario.', 'COMPANY_CONTEXT_CHANGED');
        if (current?.deleted_at) return fail('El registro fue eliminado en el servidor. Actualice la pantalla.', 'CANONICAL_RECORD_DELETED');
        const descriptor = registry.descriptor(entity);
        const cached = registry.recordsFor(erp.state.state.db, descriptor).find(row => descriptor.kind === 'singleton' || String(row.id) === id);
        if (current && Number(cached?.__syncVersion || 0) !== Number(current.version)) return fail('La versión del formulario no coincide con Supabase. Actualice antes de guardar.', 'CANONICAL_VERSION_CHANGED');
        if (insertOnly.has(entity) && current) {
          if (fingerprint(registry.serializableRecord(current.payload, entity)) !== fingerprint(payload)) return unavailable('Editar este borrador');
          await erp.offlineSync.applyRemoteRecord(current, { source: 'CANONICAL_EXPLICIT_ACK', force: true, forceServer: true });
          return { ok: true, confirmed: true, serverRecord: current, reused: true };
        }
        if (options.remove && !current) return fail('No existe un borrador canónico para eliminar.', 'CANONICAL_RECORD_REQUIRED');
        const base = current?.payload || {};
        if (options.remove) payload = clone(base);
        request = { intent, args: {
          p_operation_id: window.crypto.randomUUID(), p_company_id: ctx.companyId,
          p_device_id: 'ERP_EXPLICIT_CONFIRMATION', p_entity: entity,
          p_action: options.remove ? 'DELETE' : current ? 'UPDATE' : 'INSERT', p_record_id: id,
          p_payload: payload, p_base_payload: base, p_base_version: Number(current?.version || 0),
          p_field_changes: [{ path: [], base_exists: Boolean(current), base, value_exists: true, value: payload }],
          p_local_created_at: new Date().toISOString()
        }};
        pending.set(key, request);
      }
      payload = request.args.p_payload;
      // One request, no outbox or automatic retry. An explicit retry reuses all arguments.
      const { data, error } = await requestWithDeadline(client.rpc('erp_apply_offline_operation', request.args));
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data, server = result?.server_record;
      if (result?.status !== 'SYNCED' || result.conflict || (result.discarded_fields || []).length
          || !server || server.company_id !== ctx.companyId || server.entity !== entity || server.record_id !== id
          || Number(server.version || 0) < 1 || Boolean(server.deleted_at) !== Boolean(options.remove)
          || fingerprint(registry.serializableRecord(server.payload, entity)) !== fingerprint(payload)) {
        return fail('El servidor no confirmó esta versión completa. Consulte el registro antes de reintentar.', 'CANONICAL_ACK_MISMATCH');
      }
      pending.delete(key);
      if (fingerprint(identity()) !== fingerprint(ctx)) return fail('El servidor guardó en la empresa de origen. La sesión cambió: consulte allí el resultado.', 'COMPANY_CONTEXT_CHANGED');
      let refreshRequired = false;
      try { await erp.offlineSync.applyRemoteRecord(server, { source: 'CANONICAL_EXPLICIT_ACK', force: true, forceServer: true }); }
      catch { refreshRequired = true; }
      return { ok: true, confirmed: true, serverRecord: server, refreshRequired };
    } catch (error) {
      const code = String(error?.code || 'CANONICAL_WRITE_FAILED');
      return fail(`No se confirmó el guardado (${code}). Reintente explícitamente el mismo cambio o consulte el registro.`, code);
    } finally { busy.delete(key); }
  }
  erp.services = erp.services || {};
  erp.services.confirmedOperationalWrite = { commit, unavailable };
})();
