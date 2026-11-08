#!/bin/bash
set -e

for database in user_db catalog_db inventory_db order_db payment_db; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --command "SELECT 'CREATE DATABASE \"$database\"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec"
done
