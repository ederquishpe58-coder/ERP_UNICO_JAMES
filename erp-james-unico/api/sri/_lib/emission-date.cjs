const { SriValidationError } = require("./errors.cjs");

const fiscalDate = require("../../../scripts/services/sri/fiscal-date.js");
const { ECUADOR_TIME_ZONE } = fiscalDate;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function ecuadorDate(now = new Date()) {
  try { return fiscalDate.ecuadorDate(now); }
  catch (error) { throw new SriValidationError("La fecha de proceso SRI no es valida."); }
}

function normalizeSourceDate(value) {
  const normalized = String(value || "").trim().slice(0, 10);
  return ISO_DATE_PATTERN.test(normalized) ? normalized : null;
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function emissionDatePolicy(input = {}, now = new Date()) {
  const today = ecuadorDate(now);
  const requestedIssueDate = normalizeSourceDate(input.issueDate);
  const sourceOrderDate = normalizeSourceDate(input.sourceOrderDate);
  const isExport = input.isExport === true;
  const issueDate = isExport ? (requestedIssueDate || sourceOrderDate || today) : today;
  if (isExport) {
    const elapsedDays = daysBetween(issueDate, today);
    if (elapsedDays < 0) throw new SriValidationError("La fecha de emision de exportacion no puede ser futura.");
    if (elapsedDays > 60) throw new SriValidationError("La exportacion supera el plazo operativo de 60 dias desde su fecha de emision.");
  } else if (requestedIssueDate && requestedIssueDate !== today) {
    throw new SriValidationError("Las ventas locales deben emitirse y autorizarse en la fecha actual de Ecuador.");
  }
  return {
    issueDate,
    requestedIssueDate,
    sourceOrderDate,
    adjusted: Boolean(requestedIssueDate && requestedIssueDate !== issueDate),
    isExport,
    timeZone: ECUADOR_TIME_ZONE
  };
}

module.exports = {
  ECUADOR_TIME_ZONE,
  ecuadorDate,
  emissionDatePolicy,
  normalizeSourceDate
};
