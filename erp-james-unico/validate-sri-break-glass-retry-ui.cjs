// Isolated browser fixture; never opens ERP PROD or an authenticated session.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SRI_MANAGER_PLAYWRIGHT || 'playwright');

const EDGE = process.env.SRI_MANAGER_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const company = 'BLESS_FLOWER';
const eligibleId = '22222222-2222-4222-8222-222222222222';
const blockedId = '33333333-3333-4333-8333-333333333333';
const accessKey = '1234567890123456789012345678901234567890123456789';

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EDGE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });

  try {
    await page.setContent('<html lang="es"><body><main id="fixture"></main></body></html>');
    await page.addStyleTag({ content: fs.readFileSync('styles.css', 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync('styles/sri-manager.css', 'utf8') });
    await page.evaluate(({ company, eligibleId, blockedId, accessKey }) => {
      if (!crypto.randomUUID) crypto.randomUUID = () => '11111111-1111-4111-8111-111111111111';
      window.calls = [];
      window.selectedCompany = company;
      const identity = id => ({
        documentId: id,
        companyId: company,
        environment: 'PRODUCTION',
        documentType: '07',
        fullNumber: id === eligibleId ? '001-002-000000757' : '001-002-000000758',
        sequential: id === eligibleId ? '000000757' : '000000758',
        accessKey,
        issueDate: '2026-09-10',
        establishment: '001',
        emissionPoint: '002',
        signedFileId: '44444444-4444-4444-8444-444444444444',
        signedXmlHash: 'a'.repeat(64),
        sourceHash: 'b'.repeat(64),
        accountingHash: 'c'.repeat(64)
      });
      const detail = id => {
        const eligible = id === eligibleId;
        const frozen = identity(id);
        return {
          document: {
            id,
            company_id: company,
            environment: 'PRODUCTION',
            document_type: '07',
            full_number: frozen.fullNumber,
            issue_date: frozen.issueDate,
            access_key: accessKey,
            status: 'PENDIENTE_REINTENTO',
            buyer_snapshot: { legalName: 'FIXTURE CUSTOMER' },
            last_error: 'Falta evidencia de fallo de recepcion anterior al procesamiento.'
          },
          responses: [{ sri_status: 'NO_ENCONTRADO' }],
          transmissionAttempts: [{ finished_at: '2026-09-10T12:00:00Z' }],
          management: { version: 0, revision: 1 },
          technicalHistory: [],
          managerEvents: [],
          files: [],
          source: { purchaseId: 'FIXTURE-PURCHASE' },
          managerPolicy: {
            manualSameDocumentRetry: {
              allowed: false,
              humanReason: 'Falta evidencia de fallo de recepcion anterior al procesamiento.',
              evidence: { identity: frozen }
            },
            breakGlassRetry: {
              allowed: eligible,
              offered: true,
              reasonCode: 'INSUFFICIENT_RECEPTION_EVIDENCE',
              humanReason: eligible ? 'Requiere confirmacion extraordinaria.' : 'El comprobante requiere revision administrativa.',
              evidence: { identity: frozen }
            },
            automaticBudgetExhausted: true,
            transmissionState: 'TRANSPORT_RESULT_UNCERTAIN',
            retryState: 'MANUAL_REVIEW_REQUIRED',
            recoveryState: 'AUTHORIZATION_LOOKUP_FIRST',
            message: 'El resultado de recepcion anterior es incierto.',
            actions: {
              validate: { allowed: false, reason: 'No aplica en este fixture.' },
              recover: { allowed: false, reason: 'Consulta final ya registrada.' },
              retry: { allowed: false, reason: 'Falta evidencia de fallo de recepcion anterior al procesamiento.' },
              breakGlassRetry: { allowed: eligible, reason: eligible ? '' : 'Requiere revision administrativa.' },
              pause: { allowed: false, reason: 'No aplica en este fixture.' },
              resume: { allowed: false, reason: 'No aplica en este fixture.' },
              correct: { allowed: false, reason: 'No aplica en este fixture.' },
              evidence: { allowed: false, reason: 'No aplica en este fixture.' }
            }
          }
        };
      };
      const api = {
        managerCompany: () => ({ companyId: selectedCompany, commercialName: selectedCompany === company ? 'BLESS FLOWER' : 'OTHER' }),
        managerRequest: async (action, data, method) => {
          calls.push({ action, data, method, company: selectedCompany });
          if (action === 'manager-list') return { rows: [detail(eligibleId).document, detail(blockedId).document], total: 2 };
          if (action === 'manager-detail') return detail(data.documentId);
          if (action === 'manager-break-glass-retry') return detail(data.documentId);
          throw new Error(`Unexpected fixture action ${action}`);
        }
      };
      window.BlessERP = {
        sriApi: api,
        state: { state: { currentRoute: 'sri-document-manager', db: { activeCompanyId: company } } },
        services: { companyContext: { activeCompanyId: () => selectedCompany } }
      };
    }, { company, eligibleId, blockedId, accessKey });

    await page.addScriptTag({ content: fs.readFileSync('scripts/modules/sri/document-manager.js', 'utf8') });
    const render = () => page.evaluate(() => BlessERP.modules.sriDocumentManager.render(
      document.getElementById('fixture'),
      { id: 'sri-document-manager' },
      BlessERP.state.state
    ));

    await render();
    await page.getByRole('button', { name: 'Ver / gestionar' }).first().click();
    await page.getByRole('heading', { name: '001-002-000000757', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Recuperación / gestión', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Reintentar envío', exact: true }).isEnabled(), false);
    assert.equal(await page.getByRole('button', { name: 'Reintento extraordinario', exact: true }).isEnabled(), true);
    assert.match(await page.locator('#fixture').innerText(), /Reintento extraordinario: DISPONIBLE/);

    await page.getByRole('button', { name: 'Reintento extraordinario', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /El sistema no puede demostrar qué ocurrió en la recepción anterior\./);
    assert.match(await dialog.innerText(), /EL MISMO comprobante/);
    assert.match(await dialog.innerText(), /NO CAMBIA/);
    assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'manager-break-glass-retry').length), 0);
    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click();

    await page.getByRole('button', { name: 'Reintento extraordinario', exact: true }).click();
    await page.getByRole('button', { name: 'CONFIRMO REINTENTO EXTRAORDINARIO', exact: true }).click();
    await page.waitForFunction(() => calls.some(call => call.action === 'manager-break-glass-retry'));
    const extraordinary = await page.evaluate(() => calls.filter(call => call.action === 'manager-break-glass-retry'));
    assert.equal(extraordinary.length, 1);
    assert.equal(extraordinary[0].data.confirmBreakGlass, true);
    assert.equal(extraordinary[0].data.identity.documentId, eligibleId);
    assert.equal(extraordinary[0].data.identity.sequential, '000000757');
    assert.equal(extraordinary[0].data.identity.accessKey, accessKey);
    assert.equal(extraordinary[0].data.identity.issueDate, '2026-09-10');
    assert.equal(extraordinary[0].data.identity.signedXmlHash, 'a'.repeat(64));
    assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'manager-retry').length), 0);

    await page.getByRole('button', { name: 'Ver / gestionar' }).nth(1).click();
    await page.getByRole('heading', { name: '001-002-000000758', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Recuperación / gestión', exact: true }).click();
    const blocked = page.getByRole('button', { name: 'Reintento extraordinario', exact: true });
    assert.equal(await blocked.count(), 1);
    assert.equal(await blocked.isEnabled(), false);

    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(JSON.stringify({
      result: 'PASS',
      extraordinaryAvailable: true,
      warningAndCancel: true,
      sameIdentity: true,
      normalRetryUntouched: true,
      blockedState: true,
      realNetworkCalls: 0,
      realSRI: 0
    }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
