(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const OPERATIONS_V2_ENTITIES = new Set([
    "operations_receptions",
    "operations_classifier_assignments",
    "operations_classification_results",
    "operations_inventory_movements"
  ]);

  const ZEBRA_V2_ENTITIES = new Set([
    "operations_bunches"
  ]);

  const DESTINATION_V2_ENTITIES = new Set([
    "operations_destination_lots"
  ]);

  const WAREHOUSE_V2_ENTITIES = new Set([
    "commercial_order_reservations",
    "operations_bunch_order_assignments",
    "operations_order_boxes",
    "operations_order_movements"
  ]);

  const DISPATCH_V2_ENTITIES = new Set([
    "operations_dispatch_records"
  ]);

  const EXPORT_V2_ENTITIES = new Set([
    "commercial_export_shipments",
    "commercial_export_shipment_documents",
    "commercial_export_shipment_flights",
    "commercial_export_shipment_events"
  ]);

  const FINANCIAL_V2_ENTITIES = new Set([
    "financial_journal_entries",
    "financial_receivables",
    "financial_credit_notes",
    "financial_collections",
    "financial_order_costs",
    "financial_shipment_expenses",
    "financial_cost_allocations",
    "financial_events"
  ]);
  const SUPPLIER_FINANCE_V2_ENTITIES = new Set([
    "supplier_providers",
    "supplier_purchase_documents",
    "supplier_payables",
    "supplier_settlements",
    "supplier_reception_costs",
    "supplier_payments"
  ]);
  const TREASURY_V2_ENTITIES = new Set([
    "treasury_bank_accounts",
    "treasury_cash_accounts",
    "treasury_bank_transactions",
    "treasury_cash_transactions",
    "treasury_reconciliations",
    "treasury_reconciliation_matches",
    "treasury_reconciliation_reviews",
    "treasury_transfers",
    "treasury_adjustments"
  ]);
  const PAYROLL_V2_ENTITIES = new Set([
    "payroll_v2_employees",
    "payroll_v2_operational_roles",
    "payroll_v2_periods",
    "payroll_v2_roles",
    "payroll_v2_role_items",
    "payroll_v2_role_lines",
    "payroll_v2_performance_snapshots",
    "payroll_v2_performance_policies",
    "payroll_v2_policy_assignments",
    "payroll_v2_policy_snapshots",
    "payroll_v2_events"
  ]);

  const PRELOAD_CLASS = Object.freeze({
    REQUIRED: "A_REQUIRED",
    DOMAIN: "B_DOMAIN_LAZY",
    SEARCH: "C_SEARCH_RPC",
    HISTORICAL: "D_HISTORICAL_NO_PRELOAD",
    DORMANT: "E_LEGACY_DORMANT"
  });

  // Campos de presentacion calculados a partir de datos canonicos. Nunca deben
  // participar en snapshots, diffs, payloads offline ni rehidratacion del store.
  // La metadata por entidad evita que un renderer futuro vuelva a convertir una
  // proyeccion visual en una escritura.
  const DERIVED_FIELDS_BY_ENTITY = Object.freeze({
    operations_rose_inventory: Object.freeze(["ageDays"]),
    operations_availability: Object.freeze(["edad_dias"])
  });

  // CONT-D Fase 2: el bootstrap es una lista positiva. Una entidad que no tenga
  // una decisión explicita hace fallar el registro; nunca vuelve a bootstrap por
  // omisión. Los dominios grandes se hidratan al entrar en una ruta que realmente
  // los consume y los reportes históricos usan sus RPC/read-models.
  const REQUIRED_PRELOAD_ENTITIES = new Set([
    "company_settings",
    "accounting_chart_accounts",
    "accounting_tax_parameters",
    "accounting_retention_parameters",
    "accounting_tax_supports",
    "accounting_purchase_types",
    "accounting_document_sequences",
    "accounting_cost_centers",
    "tax_ats_config"
  ]);

  const SEARCH_RPC_ENTITIES = new Set([
    "financial_events",
    "supplier_settlements",
    "supplier_adjustments",
    "treasury_transfers",
    "treasury_adjustments"
  ]);

  const HISTORICAL_NO_PRELOAD_ENTITIES = new Set([]);

  // No se declara dormida ninguna entidad sin evidencia suficiente. Los demos
  // de Operaciones siguen protegidos porque todavia tienen consumidores activos.
  const LEGACY_DORMANT_ENTITIES = new Set([]);

  const DOMAIN_ENTITIES = Object.freeze({
    "commercial-catalog": Object.freeze([
      "commercial_customers", "commercial_brands", "commercial_agencies", "commercial_airlines",
      "commercial_countries", "commercial_dae", "commercial_destinations", "customers"
    ]),
    "commercial-workspace": Object.freeze([
      "commercial_orders", "commercial_preorders", "commercial_reservations",
      "commercial_order_reservations", "commercial_export_shipments",
      "commercial_export_shipment_documents", "commercial_export_shipment_flights",
      "commercial_export_shipment_events", "sales"
    ]),
    "operations-catalog": Object.freeze([
      "operations_suppliers", "operations_classifiers", "operations_bunchers",
      "operations_receptionists", "operations_digitizers", "operations_scanners",
      "operations_responsibles", "operations_varieties", "operations_lengths",
      "operations_stem_types", "operations_label_types", "operations_yield_settings"
    ]),
    "operations-workspace": Object.freeze([
      "operations_receptions", "operations_classifier_assignments", "operations_classification_results",
      "operations_classifications", "operations_bunches", "operations_destination_lots",
      "operations_label_batches", "operations_rose_inventory", "operations_performances",
      "operations_mesh_records", "operations_mesh_history", "operations_mesh_history_audit",
      "operations_bunch_entries", "operations_scanner_events", "operations_inventory_movements",
      "operations_bunch_order_assignments", "operations_order_boxes", "operations_order_movements",
      "operations_dispatch_records", "operations_consumptions", "operations_kardex",
      "operations_dispatches", "operations_reservations", "operations_availability",
      "operations_yield_workday", "operations_yield_workday_history"
    ]),
    "purchases-catalog": Object.freeze([
      "accounting_purchase_memory", "accounting_providers", "supplier_providers"
    ]),
    "purchases-workspace": Object.freeze([
      "purchases", "purchase_payables", "issued_withholdings", "supplier_purchase_documents",
      "supplier_payables", "supplier_reception_costs", "supplier_payments"
    ]),
    "portfolio-workspace": Object.freeze([
      "payments", "payment_batches", "customer_receivables", "collections", "collection_batches",
      "received_withholdings", "financial_receivables", "financial_credit_notes", "financial_collections"
    ]),
    "treasury-catalog": Object.freeze([
      "bank_accounts", "treasury_bank_accounts", "treasury_cash_accounts"
    ]),
    "treasury-workspace": Object.freeze([
      "bank_movements", "bank_statement_movements", "bank_reconciliations", "treasury_bank_transactions",
      "treasury_cash_transactions", "treasury_reconciliations", "treasury_reconciliation_matches",
      "treasury_reconciliation_reviews"
    ]),
    "finance-workspace": Object.freeze([
      "accounting_journal_entries", "financial_journal_entries", "financial_order_costs",
      "financial_shipment_expenses", "financial_cost_allocations"
    ]),
    "inventory-catalog": Object.freeze([
      "inventory_warehouses", "inventory_items", "inventory_responsibles"
    ]),
    "inventory-workspace": Object.freeze([
      "material_inventory_movements"
    ]),
    payroll: Object.freeze([
      "payroll_employees", "payroll_rate_rules", "payroll_hour_entries", "payroll_performance_entries",
      "payroll_obligation_settings", "payroll_runs", "payroll_items", "payroll_payments",
      "payroll_v2_employees", "payroll_v2_operational_roles", "payroll_v2_periods", "payroll_v2_roles",
      "payroll_v2_role_items", "payroll_v2_role_lines", "payroll_v2_performance_snapshots",
      "payroll_v2_performance_policies", "payroll_v2_policy_assignments", "payroll_v2_policy_snapshots",
      "payroll_v2_events"
    ]),
    tax: Object.freeze(["tax_ats_history"]),
    audit: Object.freeze(["accounting_audit_logs"])
  });

  const DOMAIN_BY_ENTITY = new Map();
  Object.entries(DOMAIN_ENTITIES).forEach(([domain, entities]) => {
    entities.forEach(entity => {
      if (DOMAIN_BY_ENTITY.has(entity)) throw new Error(`Entidad CONT-D duplicada en dominios: ${entity}`);
      DOMAIN_BY_ENTITY.set(entity, domain);
    });
  });

  function preloadClassForEntity(entity) {
    const key = String(entity || "");
    if (REQUIRED_PRELOAD_ENTITIES.has(key)) return PRELOAD_CLASS.REQUIRED;
    if (DOMAIN_BY_ENTITY.has(key)) return PRELOAD_CLASS.DOMAIN;
    if (SEARCH_RPC_ENTITIES.has(key)) return PRELOAD_CLASS.SEARCH;
    if (HISTORICAL_NO_PRELOAD_ENTITIES.has(key)) return PRELOAD_CLASS.HISTORICAL;
    if (LEGACY_DORMANT_ENTITIES.has(key)) return PRELOAD_CLASS.DORMANT;
    throw new Error(`Entidad CONT-D sin decisión explícita: ${key}`);
  }

  const DESCRIPTORS = Object.freeze([
    // Configuración empresarial. Los objetos singleton se sincronizan como un
    // solo registro por empresa; el navegador nunca es su única fuente.
    ["company_settings", "companySettings", "singleton"],
    ["accounting_chart_accounts", "chartOfAccounts"],
    ["accounting_tax_parameters", "taxParameters"],
    ["accounting_retention_parameters", "retentionParameters"],
    ["accounting_tax_supports", "taxSupports"],
    ["accounting_purchase_types", "purchaseTypes"],
    ["accounting_purchase_memory", "purchaseMemory"],
    ["accounting_document_sequences", "documentSequences"],
    ["accounting_cost_centers", "costCenters"],
    ["inventory_warehouses", "inventoryWarehouses"],
    ["inventory_items", "inventoryItems"],
    ["inventory_responsibles", "inventoryResponsibles"],
    ["tax_ats_config", "atsConfig", "singleton"],
    ["tax_ats_history", "atsHistory"],

    // Comercial / exportaciones.
    ["commercial_orders", "commercial.orders"],
    ["commercial_preorders", "commercial.preorders"],
    ["commercial_reservations", "commercial.reservations"],
    ["commercial_order_reservations", "commercial.orderReservations"],
    ["commercial_customers", "commercial.customerCatalog"],
    ["commercial_brands", "commercial.brandCatalog"],
    ["commercial_agencies", "commercial.agencyCatalog"],
    ["commercial_airlines", "commercial.airlineCatalog"],
    ["commercial_countries", "commercial.countryCatalog"],
    ["commercial_dae", "commercial.daeCatalog"],
    ["commercial_destinations", "commercial.destinationCatalog"],
    ["commercial_export_shipments", "commercial.exportShipments"],
    ["commercial_export_shipment_documents", "commercial.exportShipmentDocuments"],
    ["commercial_export_shipment_flights", "commercial.exportShipmentFlights"],
    ["commercial_export_shipment_events", "commercial.exportShipmentEvents"],

    // Operaciones / poscosecha.
    ["operations_receptions", "operations.receptions"],
    ["operations_classifier_assignments", "operations.classifierAssignments"],
    ["operations_classification_results", "operations.classificationResults"],
    ["operations_classifications", "operations.classifications"],
    ["operations_bunches", "operations.bunches"],
    ["operations_destination_lots", "operations.destinationLots"],
    ["operations_label_batches", "operations.labelBatches"],
    ["operations_rose_inventory", "operations.roseInventory"],
    ["operations_performances", "operations.performances"],
    ["operations_mesh_records", "operations.meshProcessingRecords"],
    ["operations_mesh_history", "operations.processedMeshHistory"],
    ["operations_mesh_history_audit", "operations.processedMeshHistoryAudit"],
    ["operations_bunch_entries", "operations.bunchEntries"],
    ["operations_scanner_events", "operations.scannerEvents"],
    ["operations_inventory_movements", "operations.inventoryMovements"],
    ["operations_bunch_order_assignments", "operations.bunchOrderAssignments"],
    ["operations_order_boxes", "operations.orderBoxes"],
    ["operations_order_movements", "operations.orderMovements"],
    ["operations_dispatch_records", "operations.dispatchRecords"],
    ["operations_consumptions", "operations.consumptionsDemo"],
    ["operations_kardex", "operations.kardexOperativoDemo"],
    ["operations_dispatches", "operations.dispatches"],
    ["operations_reservations", "operations.demoReservations"],
    ["operations_availability", "operations.availabilityDemo"],
    ["operations_suppliers", "operations.masterData.suppliers"],
    ["operations_classifiers", "operations.masterData.classifiers"],
    ["operations_bunchers", "operations.masterData.bunchers"],
    ["operations_receptionists", "operations.masterData.receptionists"],
    ["operations_digitizers", "operations.masterData.digitizers"],
    ["operations_scanners", "operations.masterData.scanners"],
    ["operations_responsibles", "operations.masterData.responsibles"],
    ["operations_varieties", "operations.masterData.varieties"],
    ["operations_lengths", "operations.masterData.lengths"],
    ["operations_stem_types", "operations.masterData.stemTypes"],
    ["operations_label_types", "operations.masterData.labelTypes"],
    ["operations_yield_workday", "operations.yieldWorkday", "singleton"],
    ["operations_yield_workday_history", "operations.yieldWorkdayHistory"],
    ["operations_yield_settings", "operations.yieldSettings", "singleton"],

    // Contabilidad, compras, bancos y cartera.
    ["accounting_journal_entries", "journalEntries"],
    ["accounting_providers", "providers"],
    ["accounting_audit_logs", "auditLogs"],
    ["purchases", "purchases"],
    ["purchase_payables", "purchasePayables"],
    ["issued_withholdings", "issuedWithholdings"],
    ["payments", "payments"],
    ["payment_batches", "paymentBatches"],
    ["bank_accounts", "bankAccounts"],
    ["bank_movements", "bankMovements"],
    ["bank_statement_movements", "bankStatementMovements"],
    ["bank_reconciliations", "bankReconciliations"],
    ["customers", "customers"],
    ["customer_receivables", "customerReceivables"],
    ["collections", "collections"],
    ["collection_batches", "collectionBatches"],
    ["received_withholdings", "receivedWithholdings"],
    ["material_inventory_movements", "inventoryMovements"],
    ["sales", "sales"],
    ["financial_journal_entries", "financeV2.journalEntries"],
    ["financial_receivables", "financeV2.receivables"],
    ["financial_credit_notes", "financeV2.creditNotes"],
    ["financial_collections", "financeV2.collections"],
    ["financial_order_costs", "financeV2.orderCosts"],
    ["financial_shipment_expenses", "financeV2.shipmentExpenses"],
    ["financial_cost_allocations", "financeV2.costAllocations"],
    ["financial_events", "financeV2.events"],
    ["supplier_providers", "supplierV2.providers"],
    ["supplier_purchase_documents", "supplierV2.purchaseDocuments"],
    ["supplier_payables", "supplierV2.payables"],
    ["supplier_settlements", "supplierV2.settlements"],
    ["supplier_reception_costs", "supplierV2.receptionCosts"],
    ["supplier_payments", "supplierV2.payments"],
    ["supplier_adjustments", "supplierV2.adjustments"],
    ["treasury_bank_accounts", "treasuryV2.bankAccounts"],
    ["treasury_cash_accounts", "treasuryV2.cashAccounts"],
    ["treasury_bank_transactions", "treasuryV2.bankTransactions"],
    ["treasury_cash_transactions", "treasuryV2.cashTransactions"],
    ["treasury_reconciliations", "treasuryV2.reconciliations"],
    ["treasury_reconciliation_matches", "treasuryV2.reconciliationMatches"],
    ["treasury_reconciliation_reviews", "treasuryV2.reconciliationReviews"],
    ["treasury_transfers", "treasuryV2.transfers"],
    ["treasury_adjustments", "treasuryV2.adjustments"],

    // Rol de pagos.
    ["payroll_employees", "payroll.employees"],
    ["payroll_rate_rules", "payroll.rate_rules"],
    ["payroll_hour_entries", "payroll.hour_entries"],
    ["payroll_performance_entries", "payroll.performance_entries"],
    ["payroll_obligation_settings", "payroll.obligation_settings"],
    ["payroll_runs", "payroll.payroll_runs"],
    ["payroll_items", "payroll.payroll_items"],
    ["payroll_payments", "payroll.payments"]
    ,["payroll_v2_employees", "payrollV2.employees"]
    ,["payroll_v2_operational_roles", "payrollV2.operationalRoles"]
    ,["payroll_v2_periods", "payrollV2.periods"]
    ,["payroll_v2_roles", "payrollV2.roles"]
    ,["payroll_v2_role_items", "payrollV2.roleItems"]
    ,["payroll_v2_role_lines", "payrollV2.roleLines"]
    ,["payroll_v2_performance_snapshots", "payrollV2.performanceSnapshots"]
    ,["payroll_v2_performance_policies", "payrollV2.performancePolicies"]
    ,["payroll_v2_policy_assignments", "payrollV2.policyAssignments"]
    ,["payroll_v2_policy_snapshots", "payrollV2.policySnapshots"]
    ,["payroll_v2_events", "payrollV2.events"]
  ].map(([entity, path, kind = "collection"]) => Object.freeze({
    entity,
    path,
    kind,
    preloadClass: preloadClassForEntity(entity),
    domain: DOMAIN_BY_ENTITY.get(entity) || "",
    derivedFields: DERIVED_FIELDS_BY_ENTITY[entity] || Object.freeze([]),
    loadStrategy: REQUIRED_PRELOAD_ENTITIES.has(entity)
      ? "BOOTSTRAP"
      : DOMAIN_BY_ENTITY.has(entity)
        ? "PULL_DOMAIN"
        : SEARCH_RPC_ENTITIES.has(entity)
          ? "SEARCH_RPC"
          : HISTORICAL_NO_PRELOAD_ENTITIES.has(entity)
            ? "HISTORICAL_NO_PRELOAD"
            : "DORMANT",
    // commercial_orders tiene una RPC transaccional propia que reserva pedido y
    // factura en el servidor. Los demás dominios todavía utilizan la cola
    // incremental registro por registro; excluirlos aquí dejaba PO, etiquetas,
    // inventario y escaneos únicamente en el navegador.
    syncMode: entity === "commercial_orders" ? "EXPLICIT_FLOW_V2"
      : OPERATIONS_V2_ENTITIES.has(entity)
        ? "EXPLICIT_OPERATIONS_V2"
        : ZEBRA_V2_ENTITIES.has(entity)
          ? "EXPLICIT_ZEBRA_V2"
          : DESTINATION_V2_ENTITIES.has(entity)
            ? "EXPLICIT_DESTINATION_V2"
            : WAREHOUSE_V2_ENTITIES.has(entity)
              ? "EXPLICIT_WAREHOUSE_V2"
            : DISPATCH_V2_ENTITIES.has(entity)
              ? "EXPLICIT_DISPATCH_V2"
            : EXPORT_V2_ENTITIES.has(entity)
              ? "EXPLICIT_EXPORT_V2"
              : FINANCIAL_V2_ENTITIES.has(entity)
                ? "EXPLICIT_FINANCIAL_V2"
              : SUPPLIER_FINANCE_V2_ENTITIES.has(entity)
                ? "EXPLICIT_SUPPLIER_FINANCE_V2"
              : TREASURY_V2_ENTITIES.has(entity)
                ? "EXPLICIT_TREASURY_V2"
              : PAYROLL_V2_ENTITIES.has(entity)
                ? "EXPLICIT_PAYROLL_V2"
        : "LEGACY_INCREMENTAL"
  })));

  const BY_ENTITY = new Map(DESCRIPTORS.map(descriptor => [descriptor.entity, descriptor]));
  const ID_FIELDS = Object.freeze([
    "id",
    "operation_id",
    "inventoryId",
    "inventory_id",
    "eventId",
    "event_id",
    "availability_id",
    "code",
    "number",
    "document"
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {
        // JSON cubre los registros persistibles del ERP.
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function pathParts(path) {
    return String(path || "").split(".").filter(Boolean);
  }

  function readPath(root, path) {
    return pathParts(path).reduce((value, key) => value?.[key], root);
  }

  function ensureParent(root, path) {
    const parts = pathParts(path);
    const last = parts.pop();
    let cursor = root;
    parts.forEach(key => {
      if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    });
    return { parent: cursor, key: last };
  }

  function recordId(record) {
    if (!record || typeof record !== "object") return "";
    for (const field of ID_FIELDS) {
      const value = String(record[field] ?? "").trim();
      if (value) return value;
    }
    return "";
  }

  function recordsFor(db, descriptorOrEntity) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(descriptorOrEntity)
      : descriptorOrEntity;
    const rows = descriptor ? readPath(db, descriptor.path) : null;
    if (descriptor?.kind === "singleton") {
      return rows && typeof rows === "object" && !Array.isArray(rows) ? [rows] : [];
    }
    return Array.isArray(rows) ? rows : [];
  }

  function setRecords(db, descriptorOrEntity, records) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(descriptorOrEntity)
      : descriptorOrEntity;
    if (!descriptor || !db) return false;
    const { parent, key } = ensureParent(db, descriptor.path);
    parent[key] = descriptor.kind === "singleton"
      ? (records?.[0] && typeof records[0] === "object" ? records[0] : {})
      : (Array.isArray(records) ? records : []);
    return true;
  }

  function isBootstrapEntity(descriptorOrEntity) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(String(descriptorOrEntity || ""))
      : descriptorOrEntity;
    return descriptor?.preloadClass === PRELOAD_CLASS.REQUIRED;
  }

  function domainForEntity(entity) {
    return DOMAIN_BY_ENTITY.get(String(entity || "")) || "";
  }

  function entitiesForDomain(domain) {
    return [...(DOMAIN_ENTITIES[String(domain || "")] || [])];
  }

  function domains() {
    return Object.fromEntries(Object.entries(DOMAIN_ENTITIES).map(([domain, entities]) => [domain, [...entities]]));
  }

  function preloadEntities() {
    return DESCRIPTORS.filter(isBootstrapEntity).map(descriptor => descriptor.entity);
  }

  function nonPreloadEntities() {
    return DESCRIPTORS.filter(descriptor => !isBootstrapEntity(descriptor)).map(descriptor => descriptor.entity);
  }

  function hydrationInventory() {
    return DESCRIPTORS.map(descriptor => ({
      entity: descriptor.entity,
      path: descriptor.path,
      kind: descriptor.kind,
      syncMode: descriptor.syncMode,
      preloadClass: descriptor.preloadClass,
      domain: descriptor.domain,
      loadStrategy: descriptor.loadStrategy,
      preload: isBootstrapEntity(descriptor)
    }));
  }

  function derivedFieldsForEntity(descriptorOrEntity) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(String(descriptorOrEntity || ""))
      : descriptorOrEntity;
    return [...(descriptor?.derivedFields || [])];
  }

  function isDerivedField(descriptorOrEntity, path) {
    const first = Array.isArray(path) ? String(path[0] || "") : String(path || "").split(".")[0];
    return derivedFieldsForEntity(descriptorOrEntity).includes(first);
  }

  function sanitizePayload(descriptorOrEntity, value) {
    const output = clone(value) || {};
    derivedFieldsForEntity(descriptorOrEntity).forEach(key => delete output[key]);
    return output;
  }

  function isDerivedOnlyPayloadChange(descriptorOrEntity, previousValue, nextValue) {
    if (JSON.stringify(previousValue || {}) === JSON.stringify(nextValue || {})) return false;
    return JSON.stringify(sanitizePayload(descriptorOrEntity, previousValue))
      === JSON.stringify(sanitizePayload(descriptorOrEntity, nextValue));
  }

  function serializableRecord(record, descriptorOrEntity = "") {
    const output = clone(record) || {};
    [
      "_sync_status",
      "_sync_error",
      "_sync_operation_id",
      "_sync_conflict",
      "__syncVersion",
      "__syncUpdatedAt",
      "__syncUpdatedBy",
      "__syncDeviceId",
      "__syncOperationId"
    ].forEach(key => delete output[key]);
    return sanitizePayload(descriptorOrEntity, output);
  }

  function isSyncEligibleRecord(descriptor, record) {
    if (
      descriptor?.entity === "accounting_chart_accounts"
      && Number(record?.__syncVersion || 0) <= 0
      && BlessERP.accountingPlanBlessV1?.isEmbeddedTemplateAccount?.(record) === true
    ) {
      // La plantilla contable ayuda a una empresa vacía, pero no es un registro
      // empresarial ni puede originar INSERT/DELETE offline por sí sola.
      return false;
    }
    // Las etiquetas creadas por la RPC Zebra V2 ya fueron confirmadas por el
    // servidor. Aunque la colección conserva temporalmente etiquetas antiguas
    // del flujo legacy, un registro V2 nunca debe volver a enviarse por la
    // captura incremental genérica.
    if (descriptor?.entity === "operations_label_batches" && ["ZEBRA_V2", "DESTINATION_V2"].includes(record?.syncFlow)) return false;
    if (descriptor?.entity !== "commercial_orders") return true;
    // Crear pedido conserva el formulario nuevo solamente como borrador local.
    // Hasta que Guardar pedido asigne número y confirme el pedido, ese registro
    // no puede entrar a Supabase ni reaparecer en otro inicio de sesión.
    return record?.unsavedDraft !== true
      && record?.numberPending !== true
      && Boolean(String(record?.number || "").trim());
  }

  function recordSyncMeta(record) {
    return {
      // `version` puede ser un dato funcional del pedido/asiento. La versión de
      // sincronización siempre vive fuera del payload para no confundir ambas.
      version: Math.max(0, Number(record?.__syncVersion ?? 0) || 0),
      updatedAt: String(record?.__syncUpdatedAt ?? record?.updated_at ?? ""),
      updatedBy: String(record?.__syncUpdatedBy ?? record?.updated_by ?? ""),
      deviceId: String(record?.__syncDeviceId ?? record?.device_id ?? ""),
      operationId: String(record?.__syncOperationId ?? record?.last_operation_id ?? "")
    };
  }

  function compareServerRecord(localRecord, serverRecord) {
    if (!localRecord) return { apply: true, reason: "NEW_REMOTE_RECORD" };
    const local = recordSyncMeta(localRecord);
    const remote = {
      version: Math.max(0, Number(serverRecord?.version || 0) || 0),
      updatedAt: String(serverRecord?.updated_at || ""),
      operationId: String(serverRecord?.last_operation_id || "")
    };
    if (remote.version < local.version) {
      return { apply: false, ignoredOlder: true, reason: "OLDER_VERSION", local, remote };
    }
    if (remote.version > local.version) {
      return { apply: true, reason: "NEWER_VERSION", local, remote };
    }
    if (remote.operationId && local.operationId && remote.operationId === local.operationId) {
      return { apply: false, duplicate: true, reason: "SAME_OPERATION", local, remote };
    }
    if (remote.updatedAt && local.updatedAt && remote.updatedAt < local.updatedAt) {
      return { apply: false, ignoredOlder: true, reason: "OLDER_SERVER_TIME", local, remote };
    }
    const localFingerprint = JSON.stringify(serializableRecord(localRecord, serverRecord?.entity));
    const remoteFingerprint = JSON.stringify(sanitizePayload(serverRecord?.entity, serverRecord?.payload));
    const metadataAdvanced = Boolean(remote.operationId && remote.operationId !== local.operationId);
    if (remoteFingerprint === localFingerprint && !serverRecord?.deleted_at && !metadataAdvanced) {
      return { apply: false, duplicate: true, reason: "SAME_VERSION_AND_PAYLOAD", local, remote };
    }
    return { apply: true, reason: "SERVER_CANONICAL_SAME_VERSION", local, remote };
  }

  function snapshot(db) {
    const result = new Map();
    DESCRIPTORS.forEach(descriptor => {
      const rows = new Map();
      if (shouldSkipIncrementalCapture(descriptor)) {
        result.set(descriptor.entity, rows);
        return;
      }
      recordsFor(db, descriptor).filter(record => isSyncEligibleRecord(descriptor, record)).forEach(record => {
        const id = descriptor.kind === "singleton" ? descriptor.entity : recordId(record);
        if (!id) return;
        const clean = serializableRecord(record, descriptor);
        rows.set(id, {
          id,
          value: clean,
          fingerprint: JSON.stringify(clean),
          version: Number(record.__syncVersion || 0),
          updatedAt: String(record.__syncUpdatedAt || record.updated_at || "")
        });
      });
      result.set(descriptor.entity, rows);
    });
    return result;
  }

  function isExplicitCaptureReady(descriptorOrEntity) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(String(descriptorOrEntity || ""))
      : descriptorOrEntity;
    const syncMode = String(descriptor?.syncMode || "");
    if (syncMode === "EXPLICIT_FLOW_V2") return true;
    if (syncMode === "EXPLICIT_OPERATIONS_V2") {
      return BlessERP.getEnvConfig?.().operationsV2CaptureEnabled === true
        && BlessERP.getOperationsV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_ZEBRA_V2") {
      return BlessERP.getEnvConfig?.().zebraV2CaptureEnabled === true
        && BlessERP.getZebraV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_DESTINATION_V2") {
      return BlessERP.getEnvConfig?.().zebraV2CaptureEnabled === true
        && BlessERP.getEnvConfig?.().warehouseV2CaptureEnabled === true
        && BlessERP.getLocalDestinationV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_WAREHOUSE_V2") {
      return BlessERP.getEnvConfig?.().warehouseV2CaptureEnabled === true
        && BlessERP.getWarehouseV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_DISPATCH_V2") {
      return BlessERP.getEnvConfig?.().dispatchV2CaptureEnabled === true
        && BlessERP.getDispatchV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_EXPORT_V2") {
      return BlessERP.getEnvConfig?.().exportV2CaptureEnabled === true
        && BlessERP.getExportShipmentV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_FINANCIAL_V2") {
      return BlessERP.getEnvConfig?.().financialV2CaptureEnabled === true
        && BlessERP.getFinancialV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_SUPPLIER_FINANCE_V2") {
      return BlessERP.getEnvConfig?.().supplierFinanceV2CaptureEnabled === true
        && BlessERP.getSupplierFinanceV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_TREASURY_V2") {
      return BlessERP.getEnvConfig?.().treasuryV2CaptureEnabled === true
        && BlessERP.getTreasuryV2Repository?.()?.canExecute?.() === true;
    }
    if (syncMode === "EXPLICIT_PAYROLL_V2") {
      return BlessERP.getEnvConfig?.().payrollV2CaptureEnabled === true
        && BlessERP.getPayrollV2Repository?.()?.canExecute?.() === true;
    }
    // Las fases 005+ conservan captura incremental hasta que cada backend,
    // repositorio, RLS y Realtime hayan sido validados y tengan su guard propio.
    return false;
  }

  function shouldSkipIncrementalCapture(descriptorOrEntity) {
    const descriptor = typeof descriptorOrEntity === "string"
      ? BY_ENTITY.get(String(descriptorOrEntity || ""))
      : descriptorOrEntity;
    const syncMode = String(descriptor?.syncMode || "");
    if (syncMode === "EXPLICIT_FLOW_V2") return true;
    const config = BlessERP.getEnvConfig?.() || {};
    // El flag V2 bloquea la captura legacy desde el primer snapshot. Si el
    // health-check falla, la UI no declara V2 activo ni cae a legacy; tampoco
    // permite que una caché antigua se convierta en una escritura incremental.
    if (syncMode === "EXPLICIT_OPERATIONS_V2") return config.operationsV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_ZEBRA_V2") return config.zebraV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_DESTINATION_V2") return config.zebraV2CaptureEnabled === true && config.warehouseV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_WAREHOUSE_V2") return config.warehouseV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_DISPATCH_V2") return config.dispatchV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_EXPORT_V2") return config.exportV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_FINANCIAL_V2") return config.financialV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_SUPPLIER_FINANCE_V2") return config.supplierFinanceV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_TREASURY_V2") return config.treasuryV2CaptureEnabled === true;
    if (syncMode === "EXPLICIT_PAYROLL_V2") return config.payrollV2CaptureEnabled === true;
    return false;
  }

  function applyServerRecord(db, serverRecord, options = {}) {
    const descriptor = BY_ENTITY.get(String(serverRecord?.entity || ""));
    const id = String(serverRecord?.record_id || "").trim();
    if (!descriptor || !id || !db) return { ok: false, changed: false };
    // Los registros con escritura explícita no se capturan como operaciones
    // locales, pero sí deben aceptar la versión canónica recibida desde
    // Supabase/Realtime para que los demás equipos vean el cambio al instante.
    let rows = [...recordsFor(db, descriptor)];
    if (descriptor.entity === "accounting_chart_accounts") {
      // La primera evidencia canónica del chart retira únicamente copias
      // intactas y nunca confirmadas de OFFICIAL_ACCOUNTS. Cuentas del usuario,
      // pendientes o ya hidratadas conservan su identidad y contenido.
      rows = rows.filter(record => !(
        Number(record?.__syncVersion || 0) <= 0
        && BlessERP.accountingPlanBlessV1?.isEmbeddedTemplateAccount?.(record) === true
      ));
    }
    const index = rows.findIndex(record => (
      descriptor.kind === "singleton" ? descriptor.entity : recordId(record)
    ) === id);
    const comparison = options.forceServer === true
      ? { apply: true, reason: "SUPABASE_AUTHORITY" }
      : compareServerRecord(index >= 0 ? rows[index] : null, serverRecord);
    if (!comparison.apply) {
      return {
        ok: true,
        changed: false,
        ignoredOlder: comparison.ignoredOlder === true,
        duplicate: comparison.duplicate === true,
        reason: comparison.reason,
        localVersion: Number(comparison.local?.version || 0),
        remoteVersion: Number(comparison.remote?.version || 0)
      };
    }
    const deleted = Boolean(serverRecord.deleted_at);
    if (deleted) {
      if (index < 0) return { ok: true, changed: false, deleted: true };
      rows.splice(index, 1);
      setRecords(db, descriptor, rows);
      return { ok: true, changed: true, deleted: true };
    }
    const next = {
      ...sanitizePayload(descriptor, serverRecord.payload),
      __syncVersion: Number(serverRecord.version || 1),
      __syncUpdatedAt: String(serverRecord.updated_at || ""),
      __syncUpdatedBy: String(serverRecord.updated_by || ""),
      __syncDeviceId: String(serverRecord.device_id || ""),
      __syncOperationId: String(serverRecord.last_operation_id || "")
    };
    if (descriptor.kind !== "singleton" && !recordId(next)) next.id = id;
    const previousFingerprint = index >= 0
      ? JSON.stringify(serializableRecord(rows[index], descriptor))
      : "";
    const previousMeta = index >= 0 ? recordSyncMeta(rows[index]) : null;
    const nextFingerprint = JSON.stringify(serializableRecord(next, descriptor));
    if (index >= 0) rows[index] = next;
    else rows.push(next);
    setRecords(db, descriptor, rows);
    return {
      ok: true,
      changed: index < 0
        || previousFingerprint !== nextFingerprint
        || Number(previousMeta?.version || 0) !== Number(serverRecord.version || 1)
        || String(previousMeta?.operationId || "") !== String(serverRecord.last_operation_id || ""),
      deleted: false
    };
  }

  BlessERP.syncEntityRegistry = {
    PRELOAD_CLASS,
    descriptors: DESCRIPTORS,
    descriptor: entity => BY_ENTITY.get(String(entity || "")) || null,
    hydrationInventory,
    isBootstrapEntity,
    domainForEntity,
    entitiesForDomain,
    domains,
    nonPreloadEntities,
    preloadEntities,
    recordId,
    recordsFor,
    setRecords,
    serializableRecord,
    sanitizePayload,
    isDerivedOnlyPayloadChange,
    derivedFieldsForEntity,
    isDerivedField,
    isSyncEligibleRecord,
    recordSyncMeta,
    compareServerRecord,
    isExplicitCaptureReady,
    shouldSkipIncrementalCapture,
    snapshot,
    applyServerRecord
  };
})();
