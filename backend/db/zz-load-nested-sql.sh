#!/usr/bin/env bash
# Applies every .sql file that lives in a subdirectory of
# /docker-entrypoint-initdb.d (db/migrations, db/seeds, ...).
#
# The postgres entrypoint only runs files placed directly in that directory and
# ignores mounted subdirectories, so this script walks them in sorted path order
# (migrations/ before seeds/) and applies each one once.
#
# Scripts run only while the data volume is empty. After adding or editing a
# .sql file, re-create the volume with `docker compose down -v` and
# `docker compose up -d` to apply it.

sql_files="$(find /docker-entrypoint-initdb.d -mindepth 2 -type f -name '*.sql' | sort)"

while IFS= read -r file; do
	[ -n "$file" ] || continue
	echo "  applying ${file#/docker-entrypoint-initdb.d/}"
	if ! PGHOST= PGHOSTADDR= psql \
		--username "${POSTGRES_USER:-postgres}" \
		--dbname "${POSTGRES_DB:-$POSTGRES_USER}" \
		--no-password --no-psqlrc \
		-v ON_ERROR_STOP=1 \
		-f "$file"; then
		echo "error: failed to apply ${file}" >&2
		exit 1
	fi
done <<EOF
$sql_files
EOF
