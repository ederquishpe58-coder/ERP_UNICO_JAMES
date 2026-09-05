const { SriValidationError } = require("./errors.cjs");

const ECUADOR_TIME_ZONE = "America/Guayaquil";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function ecuadorDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new SriValidationError("La fecha de proceso SRI no es valida.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
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
