// Normaliza la config del Meta Ads Publisher en un único shape.
//
// Dos fuentes:
//   - 'env'        → modo legacy (Cellu single-tenant). Lee process.env.*.
//   - 'automation' → modo multi-tenant. Recibe un objeto automation tal
//                    como vive en KV + tokens del user (Meta + Google).
//
// El resto del publisher (drive.js, meta.js, discord.js, state.js) recibe
// esta config como input y NO lee process.env directamente. Eso permite
// correr múltiples automations en el mismo proceso (cron orchestrator).

export const DEFAULT_DAILY_BUDGET_CENTS = 4000;
export const LEGACY_TENANT_ID = 'cellu-legacy';

/**
 * @typedef {Object} DriveAuth
 * @property {'service-account' | 'oauth-user'} kind
 * @property {string} [json]            - SA JSON (cuando kind='service-account')
 * @property {string} [accessToken]     - OAuth access token (cuando kind='oauth-user')
 * @property {string} [refreshToken]    - OAuth refresh token (cuando kind='oauth-user')
 */

/**
 * @typedef {Object} PublisherConfig
 * @property {string} tenantId                    - identificador único de la automation (para state KV)
 * @property {string|null} userId                 - dueño de la automation (para auto-refresh de tokens)
 * @property {string} metaAccessToken             - token de Meta (System User o user OAuth long-lived)
 * @property {string} adAccountId                 - "act_XXXXX"
 * @property {string} pageId
 * @property {string} pixelId
 * @property {string} igUserId
 * @property {string} productLink
 * @property {DriveAuth} driveAuth
 * @property {string} driveRootFolderId
 * @property {string|null} discordWebhookUrl
 * @property {number} dailyBudgetCents            - default 4000
 * @property {string} [campaignNameTemplate]      - default "{producto} {dM} [CBO Testeo {tipo}]"
 */

/**
 * Carga la config desde process.env (modo legacy single-tenant).
 * Tira si falta alguna env var obligatoria.
 *
 * @returns {PublisherConfig}
 */
export function loadConfigFromEnv() {
  const env = process.env;
  const required = [
    'META_SYSTEM_ACCESS_TOKEN',
    'META_AD_ACCOUNT_ID',
    'META_PAGE_ID',
    'META_PIXEL_ID',
    'META_INSTAGRAM_USER_ID',
    'META_PRODUCT_LINK',
    'GOOGLE_SA_JSON',
    'DRIVE_ROOT_FOLDER_ID',
  ];
  const missing = required.filter(k => !env[k]);
  if (missing.length) {
    const err = new Error(`Faltan env vars del publisher: ${missing.join(', ')}`);
    err.missing = missing;
    throw err;
  }
  return {
    tenantId: LEGACY_TENANT_ID,
    userId: null, // legacy: no hay user owner, es la SA global
    metaAccessToken: env.META_SYSTEM_ACCESS_TOKEN,
    adAccountId: env.META_AD_ACCOUNT_ID,
    pageId: env.META_PAGE_ID,
    pixelId: env.META_PIXEL_ID,
    igUserId: env.META_INSTAGRAM_USER_ID,
    productLink: env.META_PRODUCT_LINK,
    driveAuth: { kind: 'service-account', json: env.GOOGLE_SA_JSON },
    driveRootFolderId: env.DRIVE_ROOT_FOLDER_ID,
    discordWebhookUrl: env.META_PUBLISHER_DISCORD_WEBHOOK || null,
    dailyBudgetCents: DEFAULT_DAILY_BUDGET_CENTS,
  };
}

/**
 * Convierte un objeto automation (formato KV) + tokens del user en una
 * PublisherConfig. Usado por el cron orchestrator (Fase 4).
 *
 * @param {Object} automation
 * @param {string} automation.id
 * @param {string} automation.adAccountId
 * @param {string} automation.pageId
 * @param {string} automation.pixelId
 * @param {string} automation.igUserId
 * @param {string} automation.productLink
 * @param {string} automation.driveRootFolderId
 * @param {string|null} automation.discordWebhookUrl
 * @param {number} [automation.dailyBudgetCents]
 * @param {string} [automation.campaignNameTemplate]
 *
 * @param {Object} tokens
 * @param {string} tokens.metaAccessToken
 * @param {Object} tokens.googleToken
 * @param {string} tokens.googleToken.accessToken
 * @param {string} [tokens.googleToken.refreshToken]
 *
 * @returns {PublisherConfig}
 */
export function loadConfigFromAutomation(automation, tokens) {
  if (!automation?.id) throw new Error('loadConfigFromAutomation: automation.id requerido');
  if (!tokens?.metaAccessToken) throw new Error('loadConfigFromAutomation: metaAccessToken requerido');
  if (!tokens?.googleToken?.accessToken) throw new Error('loadConfigFromAutomation: googleToken.accessToken requerido');

  return {
    tenantId: automation.id,
    userId: automation.userId,
    metaAccessToken: tokens.metaAccessToken,
    adAccountId: automation.adAccountId,
    pageId: automation.pageId,
    pixelId: automation.pixelId,
    igUserId: automation.igUserId,
    productLink: automation.productLink,
    driveAuth: {
      kind: 'oauth-user',
      accessToken: tokens.googleToken.accessToken,
      refreshToken: tokens.googleToken.refreshToken,
    },
    driveRootFolderId: automation.driveRootFolderId,
    discordWebhookUrl: automation.discordWebhookUrl || null,
    dailyBudgetCents: automation.dailyBudgetCents || DEFAULT_DAILY_BUDGET_CENTS,
    campaignNameTemplate: automation.campaignNameTemplate,
  };
}
