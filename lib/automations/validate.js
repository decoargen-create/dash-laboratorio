// Validación de inputs para crear/editar automations.
//
// Patrón: `validateForCreate(input)` y `validateForUpdate(input)` devuelven
//   { ok: true, data } | { ok: false, errors: [{ field, message }] }
//
// Reglas de cada campo:
//   - name              : 1-100 chars
//   - adAccountId       : "act_" + dígitos (ej act_1234567890)
//   - pageId/pixelId/igUserId : strings numéricos
//   - productLink       : URL https://
//   - driveRootFolderId : string non-empty (Drive IDs son base64-like ~28-44 chars)
//   - discordWebhookUrl : opcional; si está, https://discord.com/api/webhooks/
//   - dailyBudgetCents  : integer >= 100 (mínimo $1.00)
//   - campaignNameTemplate : opcional, max 200 chars

const ACT_RE = /^act_\d+$/;
const NUMERIC_RE = /^\d+$/;
const HTTPS_RE = /^https:\/\/.+/i;
const DISCORD_RE = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//i;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

const REQUIRED_FIELDS = [
  'name', 'adAccountId', 'pageId', 'pixelId', 'igUserId',
  'productLink', 'driveRootFolderId',
];

function isString(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateField(field, value, errors) {
  switch (field) {
    case 'name':
      if (!isString(value)) errors.push({ field, message: 'name requerido' });
      else if (value.length > 100) errors.push({ field, message: 'name max 100 chars' });
      break;
    case 'adAccountId':
      if (!isString(value)) errors.push({ field, message: 'adAccountId requerido' });
      else if (!ACT_RE.test(value)) errors.push({ field, message: 'adAccountId debe ser "act_" seguido de dígitos' });
      break;
    case 'pageId':
    case 'pixelId':
    case 'igUserId':
      if (!isString(value)) errors.push({ field, message: `${field} requerido` });
      else if (!NUMERIC_RE.test(value)) errors.push({ field, message: `${field} debe ser numérico` });
      break;
    case 'productLink':
      if (!isString(value)) errors.push({ field, message: 'productLink requerido' });
      else if (!HTTPS_RE.test(value)) errors.push({ field, message: 'productLink debe ser https://' });
      break;
    case 'driveRootFolderId':
      if (!isString(value)) errors.push({ field, message: 'driveRootFolderId requerido' });
      else if (!DRIVE_ID_RE.test(value)) errors.push({ field, message: 'driveRootFolderId formato inválido' });
      break;
    case 'discordWebhookUrl':
      if (value == null || value === '') break; // opcional
      if (!isString(value)) errors.push({ field, message: 'discordWebhookUrl debe ser string' });
      else if (!DISCORD_RE.test(value)) errors.push({ field, message: 'discordWebhookUrl debe ser https://discord.com/api/webhooks/...' });
      break;
    case 'dailyBudgetCents': {
      const n = Number(value);
      if (!Number.isFinite(n)) errors.push({ field, message: 'dailyBudgetCents requerido (number)' });
      else if (!Number.isInteger(n)) errors.push({ field, message: 'dailyBudgetCents debe ser integer' });
      else if (n < 100) errors.push({ field, message: 'dailyBudgetCents mínimo 100 ($1.00)' });
      break;
    }
    case 'campaignNameTemplate':
      if (value == null || value === '') break;
      if (!isString(value)) errors.push({ field, message: 'campaignNameTemplate debe ser string' });
      else if (value.length > 200) errors.push({ field, message: 'campaignNameTemplate max 200 chars' });
      break;
  }
}

/**
 * Validación para CREATE: todos los REQUIRED_FIELDS + dailyBudgetCents.
 * @returns {{ ok: true, data: object } | { ok: false, errors: Array }}
 */
export function validateForCreate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: [{ field: '_root', message: 'body inválido' }] };
  }

  for (const f of REQUIRED_FIELDS) validateField(f, input[f], errors);
  validateField('dailyBudgetCents', input.dailyBudgetCents ?? 4000, errors);
  validateField('discordWebhookUrl', input.discordWebhookUrl, errors);
  validateField('campaignNameTemplate', input.campaignNameTemplate, errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: input.name.trim(),
      enabled: !!input.enabled,
      adAccountId: input.adAccountId.trim(),
      pageId: String(input.pageId).trim(),
      pixelId: String(input.pixelId).trim(),
      igUserId: String(input.igUserId).trim(),
      productLink: input.productLink.trim(),
      driveRootFolderId: input.driveRootFolderId.trim(),
      discordWebhookUrl: input.discordWebhookUrl ? input.discordWebhookUrl.trim() : null,
      dailyBudgetCents: Math.round(Number(input.dailyBudgetCents ?? 4000)),
      campaignNameTemplate: input.campaignNameTemplate ? input.campaignNameTemplate.trim() : undefined,
    },
  };
}

/**
 * Validación para UPDATE: solo valida los campos presentes en el patch.
 * No exige todos los REQUIRED_FIELDS — eso ya pasó en el create.
 */
export function validateForUpdate(patch) {
  const errors = [];
  if (!patch || typeof patch !== 'object') {
    return { ok: false, errors: [{ field: '_root', message: 'body inválido' }] };
  }
  const editable = [
    'name', 'enabled',
    'adAccountId', 'pageId', 'pixelId', 'igUserId', 'productLink',
    'driveRootFolderId', 'discordWebhookUrl',
    'dailyBudgetCents', 'campaignNameTemplate',
  ];
  const data = {};
  for (const f of editable) {
    if (patch[f] === undefined) continue;
    if (f === 'enabled') {
      data.enabled = !!patch.enabled;
      continue;
    }
    validateField(f, patch[f], errors);
    if (!errors.find(e => e.field === f)) {
      // Normalizar igual que en create.
      if (f === 'dailyBudgetCents') data[f] = Math.round(Number(patch[f]));
      else if (f === 'discordWebhookUrl') data[f] = patch[f] ? String(patch[f]).trim() : null;
      else if (f === 'campaignNameTemplate') data[f] = patch[f] ? String(patch[f]).trim() : undefined;
      else data[f] = String(patch[f]).trim();
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, data };
}
