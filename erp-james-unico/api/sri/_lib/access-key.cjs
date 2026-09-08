const { randomInt } = require("node:crypto");
const { SriValidationError } = require("./errors.cjs");
const { ENVIRONMENTS, requireEnvironment, environmentCode } = require("./environment.cjs");

const DOCUMENT_TYPES = new Set(["01", "03", "04", "05", "06", "07"]);
const ENVIRONMENT_CODES = Object.freeze(Object.fromEntries(Object.entries(ENVIRONMENTS).map(([name, config]) => [name, config.code])));

function digits(value, length, label) {
  const normalized = String(value ?? "").trim();
  if (!new RegExp(`^[0-9]{${length}}$`).test(normalized)) {
    throw new SriValidationError(`${label} debe contener ${length} digitos.`);
  }
  return normalized;
}

function formatIssueDate(value) {
  const raw = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new SriValidationError("La fecha de emision debe usar YYYY-MM-DD.");
  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw new SriValidationError("La fecha de emision no es valida.");
  }
  return `${day}${month}${year}`;
}

function modulo11(value) {
  const source = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(source)) {
    throw new SriValidationError("El valor para modulo 11 debe ser numerico.");
  }
  let factor = 2;
  let sum = 0;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    sum += Number(source[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return 0;
  if (result === 10) return 1;
  return result;
}

function generateNumericCode() {
  return String(randomInt(0, 100000000)).padStart(8, "0");
}

function buildAccessKey(input = {}) {
  const documentType = String(input.documentType || "").trim();
  if (!DOCUMENT_TYPES.has(documentType)) {
    throw new SriValidationError("Tipo de comprobante SRI no permitido.");
  }
  const environment = requireEnvironment(input.environment);
  const code = environmentCode(environment);

  const sequentialNumber = Number(input.sequential);
  if (!Number.isSafeInteger(sequentialNumber) || sequentialNumber < 1 || sequentialNumber > 999999999) {
    throw new SriValidationError("El secuencial SRI debe estar entre 1 y 999999999.");
  }
  const sequential = String(sequentialNumber).padStart(9, "0");
  const numericCode = digits(input.numericCode, 8, "El codigo numerico");
  const emissionType = digits(input.emissionType || "1", 1, "El tipo de emision");
  if (emissionType !== "1") {
    throw new SriValidationError("El esquema offline admite tipo de emision 1.");
  }

  const base = [
    formatIssueDate(input.issueDate),
    documentType,
    digits(input.ruc, 13, "El RUC"),
    code,
    digits(input.establishmentCode, 3, "El establecimiento"),
    digits(input.emissionPointCode, 3, "El punto de emision"),
    sequential,
    numericCode,
    emissionType
  ].join("");

  if (base.length !== 48) {
    throw new SriValidationError("La base de la clave de acceso debe contener 48 digitos.");
  }
  const verificationDigit = modulo11(base);
  return {
    accessKey: `${base}${verificationDigit}`,
    verificationDigit,
    sequential,
    numericCode,
    environment,
    environmentCode: code
  };
}

function validateAccessKey(value) {
  const accessKey = value;
  if (typeof accessKey !== "string" || accessKey.length !== 49 || !/^[0-9]{49}$/.test(accessKey)) return false;
  return modulo11(accessKey.slice(0, 48)) === Number(accessKey[48]);
}

module.exports = {
  DOCUMENT_TYPES,
  ENVIRONMENT_CODES,
  modulo11,
  generateNumericCode,
  buildAccessKey,
  validateAccessKey,
  formatIssueDate
};
