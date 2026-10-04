# shellcheck shell=bash
# Shared by the audit-*.sh scripts. Sourced, not run.
#
# No credential lives in these scripts (CWE-798). The admin and student
# passwords come from the environment — ROHY_AUDIT_PASS, ROHY_STUDENT_PASS —
# and a user a script creates for itself gets a fresh random password. CI
# provisions its server with per-run random passwords (.github/workflows/ci.yml);
# against a local dev server, export the passwords you seeded, e.g.
#   ROHY_AUDIT_PASS=… ROHY_STUDENT_PASS=… bash scripts/audit-rbac.sh
#
# Bash 3.2 compatible.

# Exit with a clear message unless the named variable is set and non-empty.
audit_require() {
    local name="$1"
    eval "local value=\"\${$name:-}\""
    if [ -z "$value" ]; then
        printf 'audit: %s is not set. The audit scripts carry no default password;\n       export the password of the account they should use.\n' "$name" >&2
        exit 2
    fi
}

# A random password the server's policy accepts (8-128 characters with an
# uppercase letter, a lowercase letter and a digit): fixed "Aa1" plus 24
# characters from the OS CSPRNG.
audit_random_password() {
    python3 -c 'import secrets, string; pool = string.ascii_letters + string.digits; print("Aa1" + "".join(secrets.choice(pool) for _ in range(24)))'
}
