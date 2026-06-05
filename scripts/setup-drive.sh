#!/usr/bin/env bash
# =============================================================================
# setup-drive.sh — Configura el acceso de la app a Google Drive (Consultoría)
# vía service account, y carga las variables en Vercel.
#
# Automatiza:
#   1. Habilitar Google Drive API en el proyecto de Google Cloud.
#   2. Crear la service account + su key JSON.
#   3. Cargar GOOGLE_SERVICE_ACCOUNT_JSON (base64) y DRIVE_TRANSCRIPTS_FOLDER_ID
#      en Vercel (env Production), + CRON_SECRET opcional.
#   4. Redeploy de producción.
#
# El ÚNICO paso manual que queda: compartir la carpeta de Drive con el
# client_email que el script te imprime al final (rol Editor). Eso es tu Drive
# personal y requiere tu login, no se puede scriptear.
#
# Requisitos: gcloud CLI (https://cloud.google.com/sdk) y vercel CLI
# (npm i -g vercel), ambos logueados. Correr desde la raíz del repo.
#
# Uso:
#   ./scripts/setup-drive.sh [PROJECT_ID]
#   FOLDER_ID=... SA_NAME=... ./scripts/setup-drive.sh PROJECT_ID
# =============================================================================
set -euo pipefail

FOLDER_ID="${FOLDER_ID:-1RMTFuyhfSXlbLuO0-h4TLYCLVdEpE_Ub}"
SA_NAME="${SA_NAME:-acta-bot}"
KEY_FILE="${KEY_FILE:-./acta-bot-key.json}"

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null 2>&1 || die "Falta gcloud CLI. Instalalo: https://cloud.google.com/sdk"
command -v vercel >/dev/null 2>&1 || die "Falta vercel CLI. Instalalo: npm i -g vercel"

# ---- Proyecto de Google Cloud ----
PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "(unset)" ] || die "Pasá el PROJECT_ID como argumento o seteá uno con: gcloud config set project <ID>"
say "Proyecto Google Cloud: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ---- 1. Habilitar Drive API ----
say "Habilitando Google Drive API…"
gcloud services enable drive.googleapis.com

# ---- 2. Service account ----
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  say "La service account ya existe: $SA_EMAIL"
else
  say "Creando service account '$SA_NAME'…"
  gcloud iam service-accounts create "$SA_NAME" --display-name="Acta Bot (Consultoría)"
fi

# ---- 3. Key JSON ----
say "Generando key JSON → $KEY_FILE"
gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA_EMAIL"

# base64 portable (Linux usa -w0; mac no soporta ese flag).
if base64 --help 2>&1 | grep -q -- '-w'; then
  SA_B64="$(base64 -w0 < "$KEY_FILE")"
else
  SA_B64="$(base64 < "$KEY_FILE" | tr -d '\n')"
fi

# ---- 4. Cargar env vars en Vercel ----
# vercel env add lee el valor por stdin. Borramos antes para evitar duplicados.
push_env() {
  local name="$1" value="$2"
  vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production >/dev/null
  say "Cargada en Vercel: $name"
}

say "Cargando variables en Vercel (env Production)…"
warn "Si te pide 'Link to existing project', elegí dash-laboratorio."
push_env GOOGLE_SERVICE_ACCOUNT_JSON "$SA_B64"
push_env DRIVE_TRANSCRIPTS_FOLDER_ID "$FOLDER_ID"

if [ "${WITH_CRON_SECRET:-0}" = "1" ]; then
  CRON_SECRET_VAL="$(openssl rand -hex 16)"
  push_env CRON_SECRET "$CRON_SECRET_VAL"
fi

# ---- 5. Redeploy ----
say "Redeployando producción…"
vercel --prod --yes

# ---- Cierre: el paso manual ----
cat <<EOF

============================================================
  CASI LISTO. Falta 1 paso manual (1 clic):
------------------------------------------------------------
  Compartí la carpeta de Drive con la service account:

    1. Abrí: https://drive.google.com/drive/folders/${FOLDER_ID}
    2. Botón "Compartir".
    3. Pegá este email:  ${SA_EMAIL}
    4. Rol: Editor  → Enviar.

------------------------------------------------------------
  Verificá (esperá ~1 min al redeploy):
    curl -s https://dash-laboratorio.vercel.app/api/actas/sync | head -c 300
  Esperado: {"configured":true, ... "actas":[...]}
------------------------------------------------------------
  Seguridad: borrá la key local cuando termines:
    rm ${KEY_FILE}
============================================================
EOF
