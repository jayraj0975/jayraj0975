#!/bin/sh
# First start of the bundled PostgreSQL only. Mirrors a managed database:
# the schema owner is NOT a superuser, and the application role can neither
# own objects nor bypass row-level security.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$ACQ_OWNER_PASSWORD" -v app_pw="$ACQ_APP_PASSWORD" <<'SQL'
CREATE ROLE acquicode_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD :'owner_pw';
CREATE ROLE acquicode_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'app_pw';
CREATE DATABASE acquicode OWNER acquicode_owner;
REVOKE ALL ON DATABASE acquicode FROM PUBLIC;
GRANT CONNECT ON DATABASE acquicode TO acquicode_app;
SQL
