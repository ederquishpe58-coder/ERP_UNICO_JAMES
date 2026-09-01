(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  // U2C2A: catálogo estático de nombres, usado únicamente para validar decisiones
  // frontend. La autoridad de grants efectivos continúa siendo el resolver U2C1.
  const CAPABILITY_FAMILIES = Object.freeze({
    "core.dashboard": ["view"],
    "admin.diagnostics": ["view"],
    "admin.company_state": ["view", "edit"],
    "operations.dashboard": ["view"],
    "operations.parameters": ["view", "manage"],
    "operations.reception": ["view", "create", "edit", "cancel"],
    "operations.classification": ["view", "record", "edit"],
    "operations.labels": ["view", "create", "reprint"],
    "operations.bunch_intake": ["view", "receive", "reassign"],
    "operations.destination_orders": ["confirm"],
    "operations.boxes": ["create", "scan", "close", "reopen", "unassign", "release_order", "cancel_order"],
    "operations.inventory": ["view"],
    "operations.availability": ["view"],
    "operations.yields": ["view"],
    "operations.cold_room": ["view", "prepare", "confirm_dispatch"],
    "commercial.dashboard": ["view"],
    "commercial.orders": ["view", "create", "edit", "cancel"],
    "commercial.coordination": ["view", "edit"],
    "commercial.preorders": ["view", "create", "edit", "cancel"],
    "commercial.availability": ["view", "reserve", "release"],
    "commercial.customers": ["view", "manage"],
    "commercial.brands": ["view", "manage"],
    "commercial.cargo_agencies": ["view", "manage"],
    "commercial.countries": ["view", "manage"],
    "commercial.daes": ["view", "manage"],
    "commercial.airlines": ["view", "manage"],
    "commercial.export_products": ["view", "manage"],
    "commercial.box_types": ["view", "manage"],
    "commercial.exports": ["view", "create", "edit", "transition"],
    "commercial.senae_liquidation": ["view", "generate"],
    "commercial.credit_notes": ["view", "create", "post", "reverse"],
    "commercial.electronic_documents": ["view", "create", "authorize", "correct", "annul"],
    "commercial.route_sheet": ["print"],
    "payroll.employees": ["view", "manage"],
    "payroll.roles": ["view", "calculate", "approve", "post", "print"],
    "payroll.performance_policies": ["view", "manage"],
    "payroll.accounting_settings": ["view", "manage"],
    "accounting.chart": ["view", "manage"],
    "accounting.sales": ["view", "post"],
    "accounting.journal": ["view", "post", "reverse"],
    "accounting.ledger": ["view", "export"],
    "accounting.financial_statements": ["view", "export"],
    "accounting.costs": ["record"],
    "accounting.shipment_expenses": ["record"],
    "purchases.documents": ["view", "import", "create", "post", "reverse"],
    "purchases.providers": ["view", "manage"],
    "purchases.settlements": ["view", "create", "reverse"],
    "purchases.withholdings": ["view", "create", "reverse"],
    "purchases.retention_report": ["view", "export"],
    "purchases.tax_supports": ["view", "manage"],
    "portfolio.suppliers": ["view"],
    "portfolio.customers": ["view"],
    "portfolio.payables": ["view"],
    "portfolio.receivables": ["view"],
    "treasury.payments": ["view", "create", "reverse"],
    "treasury.collections": ["view", "create", "reverse"],
    "treasury.accounts": ["view", "manage"],
    "treasury.movements": ["view", "create", "adjust", "reverse"],
    "treasury.reconciliation": ["view", "import", "save", "execute", "review", "reverse", "set_status"],
    "treasury.cash_accounts": ["view", "manage"],
    "treasury.transfers": ["view", "create"],
    "treasury.cash_flow": ["view", "export"],
    "tax.parameters": ["view", "manage"],
    "tax.retention_parameters": ["view", "manage"],
    "tax.received_withholdings": ["view", "import"],
    "tax.ats": ["view", "generate", "export"],
    "inventory.summary": ["view"],
    "inventory.purchase_entries": ["view"],
    "inventory.kardex": ["view", "export"],
    "inventory.consumptions": ["view", "create", "reverse"],
    "inventory.adjustments": ["view", "create", "approve", "reverse"],
    "reports.dashboard": ["view"],
    "reports.accounting": ["view", "export"],
    "reports.tax": ["view", "export"],
    "reports.portfolio": ["view", "export"],
    "reports.banks": ["view", "export"],
    "reports.inventory": ["view", "export"],
    "reports.commercial": ["view", "export"],
    "admin.company": ["view", "manage"],
    "admin.users": ["view", "manage"],
    "admin.audit": ["view", "export"],
    "admin.sequences": ["view", "manage"],
    "admin.cost_centers": ["view", "manage"],
    "admin.synchronization": ["view", "manage"]
  });

  const ROUTE_CAPABILITIES = Object.freeze({
    "dashboard-home": "core.dashboard.view",
    "core-diagnostics": "admin.diagnostics.view",
    "operations-postharvest": "operations.dashboard.view",
    "operations-parameters": "operations.parameters.view",
    "operations-reception": "operations.reception.view",
    "operations-grading": "operations.classification.view",
    "operations-labels": "operations.labels.view",
    "operations-bunch-intake": "operations.bunch_intake.view",
    "operations-roses-inventory": "operations.inventory.view",
    "operations-availability": "operations.availability.view",
    "operations-yields": "operations.yields.view",
    "operations-yield-screen": "operations.yields.view",
    "operations-dispatch": "operations.cold_room.view",
    "commercial-panel": "commercial.dashboard.view",
    "commercial-orders-day": "commercial.orders.view",
    "commercial-preorders": "commercial.preorders.view",
    "commercial-order-master": "commercial.orders.view",
    "commercial-order-detail": "commercial.orders.view",
    "commercial-order-coordination": "commercial.coordination.view",
    "commercial-order-history": "commercial.orders.view",
    "commercial-availability-reservations": "commercial.availability.view",
    "commercial-customers-brands": "commercial.customers.view",
    "commercial-brands": "commercial.brands.view",
    "commercial-cargo-agencies": "commercial.cargo_agencies.view",
    "commercial-countries": "commercial.countries.view",
    "commercial-daes": "commercial.daes.view",
    "commercial-airlines": "commercial.airlines.view",
    "commercial-export-products": "commercial.export_products.view",
    "commercial-box-types": "commercial.box_types.view",
    "commercial-senae-liquidation": "commercial.senae_liquidation.view",
    "commercial-credit-notes": "commercial.credit_notes.view",
    "commercial-sri-authorization": "commercial.electronic_documents.view",
    "payroll-employees": "payroll.employees.view",
    "payroll-generation": "payroll.roles.view",
    "payroll-approved": "payroll.roles.view",
    "accounting-chart": "accounting.chart.view",
    "accounting-sales": "accounting.sales.view",
    "accounting-journal": "accounting.journal.view",
    "accounting-ledger": "accounting.ledger.view",
    "accounting-financials": "accounting.financial_statements.view",
    "purchases-upload-xml": "purchases.documents.view",
    "purchases-providers": "purchases.providers.view",
    "purchases-invoices": "purchases.documents.view",
    "purchases-manual": "purchases.documents.view",
    "purchases-supplier-settlements": "purchases.settlements.view",
    "purchases-withholdings-issued": "purchases.withholdings.view",
    "purchases-retention-report": "purchases.retention_report.view",
    "purchases-tax-supports": "purchases.tax_supports.view",
    "portfolios-suppliers": "portfolio.suppliers.view",
    "portfolios-customers": "portfolio.customers.view",
    "portfolios-ap": "portfolio.payables.view",
    "portfolios-ar": "portfolio.receivables.view",
    "portfolios-payments-single": "treasury.payments.view",
    "portfolios-collections-single": "treasury.collections.view",
    "banks-accounts": "treasury.accounts.view",
    "banks-movements": "treasury.movements.view",
    "banks-reconciliation": "treasury.reconciliation.view",
    "banks-cash": "treasury.cash_accounts.view",
    "banks-transfers": "treasury.transfers.view",
    "banks-cash-flow": "treasury.cash_flow.view",
    "tax-parameters": "tax.parameters.view",
    "tax-retention-parameters": "tax.retention_parameters.view",
    "tax-withholdings-received": "tax.received_withholdings.view",
    "tax-ats": "tax.ats.view",
    "inventory-summary": "inventory.summary.view",
    "inventory-purchase-entries": "inventory.purchase_entries.view",
    "inventory-kardex": "inventory.kardex.view",
    "inventory-consumptions": "inventory.consumptions.view",
    "inventory-adjustments": "inventory.adjustments.view",
    "reports-dashboard": "reports.dashboard.view",
    "reports-accounting": "reports.accounting.view",
    "reports-tax": "reports.tax.view",
    "reports-portfolio": "reports.portfolio.view",
    "reports-banks": "reports.banks.view",
    "reports-inventory": "reports.inventory.view",
    "reports-commercial": "reports.commercial.view",
    "settings-company": "admin.company.view",
    "settings-users": "admin.users.view",
    "settings-audit": "admin.audit.view",
    "settings-sequences": "admin.sequences.view",
    "settings-cost-centers": "admin.cost_centers.view",
    "settings-synchronization": "admin.synchronization.view"
  });

  // Carga bajo demanda exclusiva del importador CxC. No amplía el preload de
  // la ruta search-first ni autoriza dominios históricos de cartera.
  const DOMAIN_AUTHORIZATION_CONTEXTS = Object.freeze({
    "opening-balances-cxc": Object.freeze({
      capability: "accounting.sales.post",
      domains: Object.freeze(["commercial-catalog"])
    })
  });

  const knownCapabilities = Object.freeze(Object.entries(CAPABILITY_FAMILIES)
    .flatMap(([family, actions]) => actions.map(action => `${family}.${action}`))
    .sort());
  const knownSet = new Set(knownCapabilities);

  function requiredCapability(routeId) {
    return ROUTE_CAPABILITIES[String(routeId || "")] || "";
  }

  function requiredDomains(routeId) {
    return BlessERP.domainDataLoader?.routeDomains?.(String(routeId || "")) || [];
  }

  BlessERP.capabilityPolicy = Object.freeze({
    // U2C2B: capability es la autoridad frontend. Shadow permanece activo para
    // comparar la decisión legacy sin permitir que legacy abra una ruta negada.
    mode: Object.freeze({ shadow: true, hardEnforcement: true }),
    capabilityFamilies: CAPABILITY_FAMILIES,
    knownCapabilities,
    knownCapabilityCount: knownCapabilities.length,
    isKnownCapability(capabilityId) {
      return knownSet.has(String(capabilityId || ""));
    },
    domainAuthorizationContext(contextId) {
      return DOMAIN_AUTHORIZATION_CONTEXTS[String(contextId || "")] || null;
    },
    requiredCapability,
    requiredDomains,
    routeCapabilities: ROUTE_CAPABILITIES,
    routeCount: Object.keys(ROUTE_CAPABILITIES).length
  });
})();
