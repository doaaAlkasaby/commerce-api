#!/bin/sh
set -eu
node deploy/check-environment.mjs
exec "$@"
