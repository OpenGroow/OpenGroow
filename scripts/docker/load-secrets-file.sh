# Sources a generated secrets env file into the caller's shell environment,
# but only if the given guard var isn't already set directly — lets the
# unified self-host compose stack's generated secrets win by default while
# still allowing a plain env var override.
# Usage: load_secrets_file_if_unset <guard_var_name> <file_var_name>
load_secrets_file_if_unset() {
  guard_var_name=$1
  file_var_name=$2
  eval "guard_value=\${$guard_var_name:-}"
  eval "file_path=\${$file_var_name:-}"
  if [ -z "$guard_value" ] && [ -n "$file_path" ] && [ -s "$file_path" ]; then
    echo "Loading generated secrets from $file_path"
    set -a
    # shellcheck disable=SC1090
    . "$file_path"
    set +a
  fi
}
